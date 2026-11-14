"""擴充資料的抓取（#46）：Giovanni 全球月資料的全部變數 × 全球平均與世界各地。

用法（在 repo 根目錄，`.env` 要有 `EARTHDATA_TOKEN`）：
    uv run python -m trend_detective.extended                # 依序跑階段 a–f
    uv run python -m trend_detective.extended --stage a b    # 只跑指定階段
    uv run python -m trend_detective.extended --status       # 各階段目前抓到多少，並重寫目錄檔（不連網）

階段（先做完的先有資料）：
    a  核心的 Giovanni 變數 × 全球平均
    b  核心的 Giovanni 變數 × 世界區域、世界城市
    c  擴充變數 × 全球平均
    d  擴充變數 × 世界區域
    e  擴充變數 × 世界城市
    f  擴充變數 × 台灣的點位與區域

輸出在 `data/extended/`（不進 git）：`series/*.json` 與 `catalog.json`，格式與
`data/snapshot/` 相同。原始回應照舊存在 `data/raw/giovanni/`、`data/raw/harmony/`。
單點（Giovanni）用執行緒池平行抓；區域平均（Harmony）同時掛多個非同步 job。
各階段的區域平均排成同一個佇列、依階段順序送出，前面階段跑得慢的 job 不會擋住後面的。
同一天已成功的序列不重抓，中斷後重跑會接著等原本的 job；單一序列失敗不中斷整批。
"""

import argparse
import json
import re
import sys
import threading
import time
from collections import deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from trend_detective.env import read_secret
from trend_detective.giovanni import GiovanniClient, QuotaExceeded
from trend_detective.harmony import (
    FINISHED,
    HarmonyClient,
    HarmonyError,
    parse_area_csv,
)
from trend_detective.series import (
    Series,
    daily_to_monthly_points,
    monthly_points,
    write_catalog,
    write_series,
)
from trend_detective.snapshot import (
    RAW_DIR,
    SEED_DIR,
    SNAPSHOT_DIR,
    START_DATE,
    _describe,
    _one_series,
    _series_on_disk,
)

EXTENDED_DIR = Path("data/extended")
QUOTA_LIMIT = 0.95
# Harmony job 最多等多久；逾時記為失敗，job 留在紀錄裡，同一天重跑會接著等
HARMONY_MAX_WAIT_SECONDS = 3600
HARMONY_POLL_SECONDS = 10
QUOTA_CHECK_SECONDS = 60
# 區域平均進行中，每隔幾秒回報一次進度（主程式同時重寫目錄檔，先完成的先能用）
PROGRESS_SECONDS = 300
# 送出 job 遇到限流或服務忙時，同一個 job 最多重送幾次
SUBMIT_RETRIES = 3

# 階段 → [(變數的 tier, 地點的 group, 聚合方式)]
STAGES: dict[str, list[tuple[str, str, str]]] = {
    "a": [("core", "global", "area_mean")],
    "b": [("core", "world_region", "area_mean"), ("core", "world_city", "point")],
    "c": [("extended", "global", "area_mean")],
    "d": [("extended", "world_region", "area_mean")],
    "e": [("extended", "world_city", "point")],
    "f": [("extended", "taiwan", "point"), ("extended", "taiwan", "area_mean")],
}

Key = tuple[str, str, str]
Task = tuple[dict[str, Any], dict[str, Any]]


@dataclass
class RunResult:
    succeeded: list[Key] = field(default_factory=list)
    # 同一天已經成功抓過、這次沒有重抓
    reused: list[Key] = field(default_factory=list)
    # 已知沒有資料的組合（變數的 `harmony_skip_regions`），不送也不算失敗
    skipped: list[Key] = field(default_factory=list)
    failures: dict[Key, str] = field(default_factory=dict)

    def failures_by_reason(self) -> dict[str, int]:
        groups: dict[str, int] = {}
        for reason in self.failures.values():
            name = failure_group(reason)
            groups[name] = groups.get(name, 0) + 1
        return dict(sorted(groups.items(), key=lambda item: -item[1]))


def failure_group(reason: str) -> str:
    """把失敗原因歸成幾類，統計用。"""
    if "被遮罩" in reason or "整條都是缺值" in reason:
        return "整條都是缺值（海面或該產品在此沒有資料）"
    if "quota" in reason:
        return "quota 達上限，未送出"
    if "結束狀態是" in reason:
        return "Harmony job 失敗"
    if "仍未完成" in reason:
        return "Harmony job 逾時（重跑會接著等）"
    status = re.search(r"HTTP (\d{3})", reason)
    if status:
        return f"HTTP {status.group(1)}"
    return reason.split(":")[0][:60]


def load_inputs(
    seed_dir: Path, core_snapshot_dir: Path
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """讀核心與擴充的 seed，回傳 (變數, 地點)，都標上 `tier`，地點另有 `group`。

    變數只取 Giovanni 來源的。核心變數的單位與第一筆資料月份從核心快照的目錄檔來
    （Harmony 不接受早於產品第一筆的起始日）；擴充變數的在 seed 裡。
    """

    def read(name: str) -> list[dict[str, Any]]:
        path = seed_dir / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

    described: dict[str, dict[str, Any]] = {}
    catalog_path = core_snapshot_dir / "catalog.json"
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        described = {v["id"]: v for v in catalog["variables"]}
    variables = []
    for variable in read("variables.json"):
        if variable.get("source") != "giovanni":
            continue
        known = described.get(variable["id"], {})
        variables.append(
            {
                **variable,
                "tier": "core",
                "unit": known.get("unit"),
                "data_start": known.get("valid_from"),
            }
        )
    skip_by_product = {
        v["product"]: v["harmony_skip_regions"]
        for v in variables
        if v.get("harmony_skip_regions") and v.get("product")
    }
    for variable in read("variables.extended.json"):
        entry = {**variable, "tier": "extended"}
        # 同一個產品的網格相同：核心已知沒有格點中心的區域，擴充變數也不送
        if variable.get("product") in skip_by_product:
            entry.setdefault(
                "harmony_skip_regions", skip_by_product[variable["product"]]
            )
        variables.append(entry)
    locations = [
        {**loc, "tier": "core", "group": "taiwan"}
        for loc in read("locations.json")
        if "ghcnh_id" not in loc
    ]
    locations += [{**loc, "tier": "extended"} for loc in read("locations.world.json")]
    return variables, locations


class _State:
    """每條序列上次抓取的日期與結果，存成一個 JSON 檔；可給多個執行緒共用。"""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._dirty = 0
        try:
            self._data: dict[str, dict[str, str]] = json.loads(
                path.read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            self._data = {}

    def done_today(self, name: str, today: date) -> bool:
        record = self._data.get(name, {})
        return record.get("status") == "ok" and record.get("date") == today.isoformat()

    def record(self, name: str, today: date, status: str, reason: str = "") -> None:
        with self._lock:
            self._data[name] = {"date": today.isoformat(), "status": status}
            if reason:
                self._data[name]["reason"] = reason
            self._dirty += 1
            if self._dirty >= 20:
                self._save()

    def flush(self) -> None:
        with self._lock:
            self._save()

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        partial = self._path.with_suffix(".json.part")
        partial.write_text(
            json.dumps(self._data, indent=1, sort_keys=True, ensure_ascii=False),
            encoding="utf-8",
        )
        partial.replace(self._path)
        self._dirty = 0


def fetch_points(
    client: GiovanniClient,
    tasks: list[Task],
    out_dir: Path,
    *,
    today: date,
    now: str,
    raw_dir: Path | None,
    workers: int = 8,
) -> RunResult:
    """用執行緒池平行抓單點序列。同一天已成功的不重抓；quota 達上限後其餘都不送。"""
    result = RunResult()
    state = _State(out_dir / "state.point.json")
    lock = threading.Lock()
    out_of_quota = threading.Event()

    def one(task: Task) -> None:
        variable, location = task
        key = (variable["id"], location["id"], "point")
        name = "__".join(key)
        if state.done_today(name, today) and (out_dir / f"series/{name}.json").exists():
            with lock:
                result.reused.append(key)
            return
        try:
            if out_of_quota.is_set():
                raise QuotaExceeded("quota 已達上限，未抓取")
            series = _one_series(client, variable, location, today, now, raw_dir)
            write_series(out_dir, series)
        except Exception as err:  # noqa: BLE001 單一序列不論何種失敗都不中斷整批
            if isinstance(err, QuotaExceeded):
                out_of_quota.set()
            reason = f"{type(err).__name__}: {err}"
            state.record(name, today, "failed", reason[:300])
            with lock:
                result.failures[key] = reason
        else:
            state.record(name, today, "ok")
            with lock:
                result.succeeded.append(key)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(one, tasks))
    state.flush()
    return result


def _area_start(variable: dict[str, Any]) -> date:
    first = variable.get("data_start")
    return max(START_DATE, date.fromisoformat(first[:10])) if first else START_DATE


def fetch_areas(
    client: HarmonyClient,
    tasks: list[Task],
    out_dir: Path,
    *,
    today: date,
    now: str,
    raw_dir: Path,
    max_jobs: int = 12,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    log: Callable[[str], None] = lambda _message: None,
) -> RunResult:
    """每個 (變數, 區域) 送一個 Harmony 區域平均 job，同時最多掛 `max_jobs` 個。

    job id 記在 `raw_dir/harmony/jobs.extended.json`、結果 CSV 存在旁邊：同一天重跑時，
    已成功的不重送，還在跑的接著等。
    """
    result = RunResult()
    state = _State(out_dir / "state.area.json")
    harmony_dir = raw_dir / "harmony"
    harmony_dir.mkdir(parents=True, exist_ok=True)
    jobs_path = harmony_dir / "jobs.extended.json"
    try:
        jobs: dict[str, dict[str, str]] = json.loads(
            jobs_path.read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        jobs = {}

    def save_jobs() -> None:
        partial = jobs_path.with_suffix(".json.part")
        partial.write_text(json.dumps(jobs, indent=1, sort_keys=True), encoding="utf-8")
        partial.replace(jobs_path)

    def finish(variable: dict[str, Any], region: dict[str, Any], text: str) -> None:
        key = (variable["id"], region["id"], "area_mean")
        name = "__".join(key)
        try:
            parsed = parse_area_csv(text)
            if not any(value is not None for _, value in parsed.rows):
                raise HarmonyError("區域平均整條都是缺值")
            if variable.get("unit") is None:
                raise HarmonyError("不知道這個變數的單位（seed 或核心目錄檔沒有）")
            to_points = (
                daily_to_monthly_points
                if variable["native_temporal_res"] == "day"
                else monthly_points
            )
            write_series(
                out_dir,
                Series(
                    variable_id=variable["id"],
                    location_id=region["id"],
                    aggregation="area_mean",
                    unit=variable["unit"],
                    source_api="harmony",
                    request={
                        "collection": variable["harmony_collection"],
                        "variable": variable["source_variable_id"],
                        "bbox": region["bbox"],
                        "average": "area",
                        "format": "text/csv",
                        "start": f"{_area_start(variable):%Y-%m-%d}",
                        "end_policy": "run_date",
                    },
                    retrieved_at=now,
                    product_version=variable["product_version"],
                    grid=None,
                    points=to_points(parsed.rows),
                ),
            )
        except Exception as err:  # noqa: BLE001 單一序列不論何種失敗都不中斷整批
            fail(key, f"{type(err).__name__}: {err}")
        else:
            state.record(name, today, "ok")
            result.succeeded.append(key)

    def fail(key: Key, reason: str) -> None:
        state.record("__".join(key), today, "failed", reason[:300])
        result.failures[key] = reason

    run_date = today.isoformat()
    pending: deque[tuple[dict[str, Any], dict[str, Any], int]] = deque()
    # 名稱 → (變數, 區域, job id, 開始等的時間)
    running: dict[str, tuple[dict[str, Any], dict[str, Any], str, float]] = {}
    for variable, region in tasks:
        key = (variable["id"], region["id"], "area_mean")
        name = f"{key[0]}__{key[1]}"
        if region["id"] in variable.get("harmony_skip_regions", []):
            result.skipped.append(key)
            continue
        if not variable.get("harmony_collection"):
            fail(key, "HarmonyError: seed 沒有 harmony_collection（CMR 查不到）")
            continue
        record = jobs.get(name, {})
        cached = harmony_dir / f"{name}.csv"
        same_day = record.get("end") == run_date
        if (
            state.done_today("__".join(key), today)
            and (out_dir / f"series/{'__'.join(key)}.json").exists()
        ):
            result.reused.append(key)
        elif same_day and record.get("status") == "successful" and cached.exists():
            finish(variable, region, cached.read_text(encoding="utf-8"))
        elif same_day and record.get("status") not in FINISHED and record.get("job_id"):
            running[name] = (variable, region, record["job_id"], clock())
        else:
            pending.append((variable, region, 0))

    out_of_quota = False
    last_quota_check: float | None = None
    strikes: dict[str, int] = {}
    total = len(pending) + len(running)
    last_log = clock()
    while pending or running:
        if (
            pending
            and len(running) < max_jobs
            and not out_of_quota
            and (
                last_quota_check is None
                or clock() - last_quota_check >= QUOTA_CHECK_SECONDS
            )
        ):
            last_quota_check = clock()
            try:
                out_of_quota = client.quota() >= QUOTA_LIMIT
            except HarmonyError:
                pass  # 查不到就當作還有額度，交給送出本身報錯
        throttled = False
        while pending and len(running) < max_jobs and not throttled:
            variable, region, attempts = pending.popleft()
            key = (variable["id"], region["id"], "area_mean")
            name = f"{key[0]}__{key[1]}"
            try:
                if out_of_quota:
                    raise HarmonyError("quota 已達上限，未送出")
                job_id = client.submit(
                    variable["harmony_collection"],
                    variable["source_variable_id"],
                    bbox=region["bbox"],
                    start=_area_start(variable),
                    end=today,
                )
            except Exception as err:  # noqa: BLE001
                reason = f"{type(err).__name__}: {err}"
                busy = re.search(r"HTTP (429|5\d\d)", reason) is not None
                if busy and attempts < SUBMIT_RETRIES:
                    # 限流或服務忙：放回佇列，這一輪先不再送，等下一輪輪詢後再試
                    pending.appendleft((variable, region, attempts + 1))
                    throttled = True
                else:
                    fail(key, reason)
                continue
            jobs[name] = {
                "job_id": job_id,
                "end": run_date,
                "status": "running",
                "submitted_at": now,
            }
            save_jobs()
            running[name] = (variable, region, job_id, clock())
        if not running:
            if pending:
                sleep(HARMONY_POLL_SECONDS)
            continue
        sleep(HARMONY_POLL_SECONDS)
        for name, (variable, region, job_id, started) in list(running.items()):
            key = (variable["id"], region["id"], "area_mean")
            try:
                status, link, message = client.job(job_id)
                text = None
                if status == "successful" and link is not None:
                    text = client.download(link)
            except Exception as err:  # noqa: BLE001
                # 輪詢或下載的暫時性錯誤：先當作還在跑，連續 5 次才放棄
                strikes[job_id] = strikes.get(job_id, 0) + 1
                if strikes[job_id] >= 5:
                    del running[name]
                    fail(key, f"{type(err).__name__}: {err}")
                continue
            strikes.pop(job_id, None)
            if status not in FINISHED:
                if clock() - started >= HARMONY_MAX_WAIT_SECONDS:
                    del running[name]
                    fail(
                        key,
                        f"job {job_id} 等了 {HARMONY_MAX_WAIT_SECONDS} 秒仍未完成；同一天重跑會接著等",
                    )
                continue
            del running[name]
            if text is None:
                jobs[name]["status"] = status
                save_jobs()
                fail(
                    key,
                    f"HarmonyError: job {job_id} 結束狀態是 {status}：{message[:300]}",
                )
                continue
            (harmony_dir / f"{name}.csv").write_text(text, encoding="utf-8")
            # 結果存好之後才記成 successful，下載失敗時下次會接著用同一個 job
            jobs[name]["status"] = status
            save_jobs()
            finish(variable, region, text)
        if clock() - last_log >= PROGRESS_SECONDS:
            last_log = clock()
            done = total - len(pending) - len(running)
            state.flush()
            log(
                f"  區域平均 {done}/{total}，執行中 {len(running)}，失敗 {len(result.failures)}"
            )
    state.flush()
    return result


def stage_tasks(
    stage: str, variables: list[dict[str, Any]], locations: list[dict[str, Any]]
) -> tuple[list[Task], list[Task]]:
    """一個階段要抓的 (單點任務, 區域平均任務)。"""
    points: list[Task] = []
    areas: list[Task] = []
    for tier, group, aggregation in STAGES[stage]:
        kind = "point" if aggregation == "point" else "region"
        for variable in variables:
            if variable["tier"] != tier:
                continue
            for location in locations:
                if location.get("group") == group and location.get("kind") == kind:
                    (points if kind == "point" else areas).append((variable, location))
    return points, areas


def write_extended_catalog(
    out_dir: Path,
    variables: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    *,
    now: str,
) -> Path:
    """依磁碟上的序列檔寫目錄檔，格式與核心快照的 `catalog.json` 相同。

    只列出至少有一條序列的變數與地點。
    """
    all_series = _series_on_disk(out_dir)
    variable_ids = {s.variable_id for s in all_series}
    location_ids = {s.location_id for s in all_series}
    return write_catalog(
        out_dir,
        [_describe(v, all_series) for v in variables if v["id"] in variable_ids],
        [loc for loc in locations if loc["id"] in location_ids],
        all_series,
        generated_at=now,
        stamp=True,
    )


def merge(into: RunResult, other: RunResult) -> None:
    into.succeeded += other.succeeded
    into.reused += other.reused
    into.skipped += other.skipped
    into.failures.update(other.failures)


def summary(result: RunResult) -> str:
    lines = [
        (
            f"成功 {len(result.succeeded)}，沿用今天已抓的 {len(result.reused)}，"
            f"已知無資料不送 {len(result.skipped)}，失敗 {len(result.failures)}"
        )
    ]
    for reason, count in result.failures_by_reason().items():
        lines.append(f"  失敗 × {count}：{reason}")
    return "\n".join(lines)


def status(
    out_dir: Path, variables: list[dict[str, Any]], locations: list[dict[str, Any]]
) -> str:
    """各階段目前的進度：已有序列檔的、最近一次失敗的（依原因分組）、還沒抓的。"""
    records: dict[str, dict[str, str]] = {}
    for name in ("state.point.json", "state.area.json"):
        try:
            records.update(json.loads((out_dir / name).read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    lines = []
    for stage in sorted(STAGES):
        points, areas = stage_tasks(stage, variables, locations)
        result = RunResult()
        todo = 0
        for aggregation, tasks in (("point", points), ("area_mean", areas)):
            for variable, location in tasks:
                key = (variable["id"], location["id"], aggregation)
                name = "__".join(key)
                if location["id"] in variable.get("harmony_skip_regions", []):
                    result.skipped.append(key)
                elif (out_dir / f"series/{name}.json").exists():
                    result.succeeded.append(key)
                elif records.get(name, {}).get("status") == "failed":
                    result.failures[key] = records[name].get("reason", "")
                else:
                    todo += 1
        lines.append(
            f"階段 {stage}：已有 {len(result.succeeded)}，失敗 {len(result.failures)}，"
            f"已知無資料不送 {len(result.skipped)}，尚未抓 {todo}"
        )
        for reason, count in result.failures_by_reason().items():
            lines.append(f"  失敗 × {count}：{reason}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="抓取擴充資料（#46）")
    parser.add_argument("--stage", nargs="+", choices=sorted(STAGES), default=None)
    parser.add_argument(
        "--kind",
        choices=("point", "area", "both"),
        default="both",
        help="只跑單點或只跑區域平均（兩個行程可以同時各跑一種）",
    )
    parser.add_argument("--point-workers", type=int, default=8)
    parser.add_argument("--harmony-jobs", type=int, default=12)
    parser.add_argument("--out-dir", type=Path, default=EXTENDED_DIR)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--seed-dir", type=Path, default=SEED_DIR)
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args(argv)

    def log(message: str) -> None:
        print(f"{datetime.now(UTC):%H:%M:%SZ} {message}", flush=True)

    variables, locations = load_inputs(args.seed_dir, args.snapshot_dir)
    started_at = datetime.now(UTC)
    now = started_at.strftime("%Y-%m-%dT%H:%M:%SZ")
    if args.status:
        write_extended_catalog(args.out_dir, variables, locations, now=now)
        print(status(args.out_dir, variables, locations))
        return 0
    token = read_secret(
        "EARTHDATA_TOKEN",
        args.env_file,
        how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
    )
    giovanni = GiovanniClient(token, quota_ttl=QUOTA_CHECK_SECONDS, retries=4)
    harmony = HarmonyClient(token)
    points: list[Task] = []
    areas: list[Task] = []
    for stage in args.stage or sorted(STAGES):
        stage_points, stage_areas = stage_tasks(stage, variables, locations)
        points += stage_points if args.kind != "area" else []
        areas += stage_areas if args.kind != "point" else []
    log(f"單點 {len(points)} 條，區域平均 {len(areas)} 條")
    began = time.monotonic()
    quota_before = harmony.quota()
    result = RunResult()

    def progress(message: str) -> None:
        log(message)
        write_extended_catalog(args.out_dir, variables, locations, now=now)

    if points:
        merge(
            result,
            fetch_points(
                giovanni,
                points,
                args.out_dir,
                today=started_at.date(),
                now=now,
                raw_dir=args.raw_dir,
                workers=args.point_workers,
            ),
        )
        progress(f"單點完成，{round(time.monotonic() - began)} 秒")
    if areas:
        merge(
            result,
            fetch_areas(
                harmony,
                areas,
                args.out_dir,
                today=started_at.date(),
                now=now,
                raw_dir=args.raw_dir,
                max_jobs=args.harmony_jobs,
                log=progress,
            ),
        )
    elapsed = round(time.monotonic() - began)
    write_extended_catalog(args.out_dir, variables, locations, now=now)
    quota_after = harmony.quota()
    log(f"結束，{elapsed} 秒，quota {quota_before} → {quota_after}")
    log(summary(result))
    print(status(args.out_dir, variables, locations))
    with (args.out_dir / "runs.jsonl").open("a", encoding="utf-8") as runs:
        record = {
            "stages": args.stage or sorted(STAGES),
            "kind": args.kind,
            "started_at": now,
            "elapsed_seconds": elapsed,
            "point_workers": args.point_workers,
            "harmony_jobs": args.harmony_jobs,
            "succeeded": len(result.succeeded),
            "reused": len(result.reused),
            "skipped": len(result.skipped),
            "failed": len(result.failures),
            "failures_by_reason": result.failures_by_reason(),
            "quota_before": quota_before,
            "quota_after": quota_after,
        }
        runs.write(json.dumps(record, ensure_ascii=False) + "\n")
    return 1 if result.failures else 0


if __name__ == "__main__":
    sys.exit(main())
