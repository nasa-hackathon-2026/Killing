"""送出 AppEEARS 的 MODIS area task，並把請求與統計 CSV 存成原檔（#7）。

AppEEARS 是非同步的：`submit` 只送件並記錄 task_id，之後用 `status` 查、
`download` 取回。憑證只從環境變數或 `.env` 讀 `APPEEARS_TOKEN`，不寫進任何輸出檔。

用法（在 repo 根目錄）：
    uv run python -m trend_detective.appeears submit
    uv run python -m trend_detective.appeears status
    uv run python -m trend_detective.appeears download
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx

from trend_detective.regions import DEFAULT_REGIONS, Region, regions_feature_collection

API_URL = "https://appeears.earthdatacloud.nasa.gov/api/"
RAW_DIR = Path("data/raw/appeears")
TOKEN_ENV = "APPEEARS_TOKEN"
START_DATE = date(2001, 1, 1)
# bundle 裡只取小檔：統計 CSV、請求 JSON、說明文件。影像檔（.nc、.tif）不下載。
SMALL_FILE_SUFFIXES = (".csv", ".json", ".md", ".txt", ".xml")


@dataclass(frozen=True)
class ModisTask:
    variable_id: str
    product: str
    layers: tuple[str, ...]


# layer 名稱於 2026-11-14 用 GET /product/<product> 確認。
MODIS_TASKS: dict[str, ModisTask] = {
    "modis_ndvi": ModisTask(
        "modis_ndvi",
        "MOD13A3.061",
        ("_1_km_monthly_NDVI", "_1_km_monthly_pixel_reliability"),
    ),
    "modis_lst": ModisTask("modis_lst", "MOD11A2.061", ("LST_Day_1km", "QC_Day")),
}


class AppeearsError(RuntimeError):
    """AppEEARS 回傳非成功狀態。訊息只含狀態碼與伺服器回應，不含憑證。"""


def build_area_task(
    task: ModisTask,
    *,
    start: date,
    end: date,
    regions: tuple[Region, ...] = DEFAULT_REGIONS,
) -> dict[str, Any]:
    """組出 `POST /task` 的 body。日期用 AppEEARS 要求的 MM-DD-YYYY。"""
    return {
        "task_type": "area",
        "task_name": f"trend-detective-{task.variable_id}-{end:%Y%m%d}",
        "params": {
            "dates": [{"startDate": f"{start:%m-%d-%Y}", "endDate": f"{end:%m-%d-%Y}"}],
            "layers": [
                {"product": task.product, "layer": layer} for layer in task.layers
            ],
            "geo": regions_feature_collection(regions),
            "output": {"format": {"type": "netcdf4"}, "projection": "geographic"},
        },
    }


class AppeearsClient:
    def __init__(self, token: str, http: httpx.Client | None = None) -> None:
        self._http = http or httpx.Client(
            base_url=API_URL, timeout=60, follow_redirects=True
        )
        self._headers = {"Authorization": f"Bearer {token}"}

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        response = self._http.request(method, path, headers=self._headers, **kwargs)
        if response.status_code >= 400:
            raise AppeearsError(
                f"AppEEARS {method} {path} → HTTP {response.status_code}: "
                f"{response.text[:300]}"
            )
        return response

    def submit(self, task: dict[str, Any]) -> str:
        return self._request("POST", "task", json=task).json()["task_id"]

    def status(self, task_id: str) -> str:
        return self._request("GET", f"task/{task_id}").json()["status"]

    def bundle_files(self, task_id: str) -> list[dict[str, Any]]:
        return self._request("GET", f"bundle/{task_id}").json()["files"]

    def file_content(self, task_id: str, file_id: str) -> bytes:
        return self._request("GET", f"bundle/{task_id}/{file_id}").content


def save_submission(
    raw_dir: Path,
    variable_id: str,
    task_id: str,
    task: dict[str, Any],
    *,
    submitted_at: str,
) -> Path:
    """把 task_id、送出時間與請求參數寫成 `submission.json`（不含憑證）。"""
    path = raw_dir / variable_id / task_id / "submission.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {"task_id": task_id, "submitted_at": submitted_at, "request": task}
    path.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


def download_small_files(
    client: AppeearsClient, task_id: str, dest: Path
) -> list[Path]:
    """下載 bundle 裡的統計 CSV、請求 JSON 與說明文件；略過影像檔。"""
    dest.mkdir(parents=True, exist_ok=True)
    saved = []
    for entry in client.bundle_files(task_id):
        name = Path(entry["file_name"]).name
        if not name.lower().endswith(SMALL_FILE_SUFFIXES):
            continue
        target = dest / name
        target.write_bytes(client.file_content(task_id, entry["file_id"]))
        saved.append(target)
    return saved


def read_token(env_file: Path) -> str:
    """先看環境變數，再看 `.env`；都沒有就說明怎麼取得。"""
    token = os.environ.get(TOKEN_ENV, "")
    if not token and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == TOKEN_ENV:
                token = value.strip().strip("\"'")
    if not token:
        raise SystemExit(
            f"找不到 {TOKEN_ENV}。先用 EDL 帳密呼叫 AppEEARS 的 POST /login，"
            f"把回傳的 token 以 {TOKEN_ENV}=… 寫進 {env_file}。"
        )
    return token


def _submissions(raw_dir: Path) -> list[dict[str, Any]]:
    return [
        json.loads(path.read_text(encoding="utf-8")) | {"dir": path.parent}
        for path in sorted(raw_dir.glob("*/*/submission.json"))
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="送出、查詢、下載 AppEEARS 的 MODIS area task"
    )
    parser.add_argument("command", choices=["submit", "status", "download"])
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    args = parser.parse_args(argv)
    client = AppeearsClient(read_token(args.env_file))

    if args.command == "submit":
        today = date.today()
        for task_def in MODIS_TASKS.values():
            task = build_area_task(task_def, start=START_DATE, end=today)
            task_id = client.submit(task)
            now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            path = save_submission(
                args.raw_dir, task_def.variable_id, task_id, task, submitted_at=now
            )
            print(f"{task_def.variable_id}\t{task_id}\t{now}\t{path}")
        return 0

    for record in _submissions(args.raw_dir):
        task_id = record["task_id"]
        status = client.status(task_id)
        print(f"{record['request']['task_name']}\t{task_id}\t{status}")
        if args.command == "download" and status == "done":
            for path in download_small_files(client, task_id, record["dir"]):
                print(f"  已存 {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
