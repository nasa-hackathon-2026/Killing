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
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx

from trend_detective.env import read_secret
from trend_detective.regions import DEFAULT_REGIONS, Region, regions_feature_collection

API_URL = "https://appeears.earthdatacloud.nasa.gov/api/"
RAW_DIR = Path("data/raw/appeears")
TOKEN_ENV = "APPEEARS_TOKEN"
SUBMISSION_FILE = "submission.json"
START_DATE = date(2001, 1, 1)
# bundle 裡只取小檔：統計 CSV、請求 JSON、說明文件。影像檔（.nc、.tif）不下載。
SMALL_FILE_SUFFIXES = (".csv", ".json", ".md", ".txt", ".xml")


@dataclass(frozen=True)
class ModisTask:
    variable_id: str
    product: str
    layers: tuple[str, ...]
    # 日期範圍切成幾段送出；8 日合成的檔案數多，一次送會超過 AppEEARS 上限。
    parts: int = 1


# layer 名稱於 2026-11-14 用 GET /product/<product> 確認。
MODIS_TASKS: dict[str, ModisTask] = {
    "modis_ndvi": ModisTask(
        "modis_ndvi",
        "MOD13A3.061",
        ("_1_km_monthly_NDVI", "_1_km_monthly_pixel_reliability"),
    ),
    "modis_lst": ModisTask(
        "modis_lst", "MOD11A2.061", ("LST_Day_1km", "QC_Day"), parts=2
    ),
}


class AppeearsError(RuntimeError):
    """AppEEARS 回傳非成功狀態。訊息只含狀態碼與伺服器回應，不含憑證。"""


def build_area_task(
    task: ModisTask,
    *,
    start: date,
    end: date,
    regions: tuple[Region, ...] = DEFAULT_REGIONS,
    task_name: str | None = None,
) -> dict[str, Any]:
    """組出 `POST /task` 的 body。日期用 AppEEARS 要求的 MM-DD-YYYY。"""
    return {
        "task_type": "area",
        "task_name": task_name or f"trend-detective-{task.variable_id}-{end:%Y%m%d}",
        "params": {
            "dates": [{"startDate": f"{start:%m-%d-%Y}", "endDate": f"{end:%m-%d-%Y}"}],
            "layers": [
                {"product": task.product, "layer": layer} for layer in task.layers
            ],
            "geo": regions_feature_collection(regions),
            "output": {"format": {"type": "netcdf4"}, "projection": "geographic"},
        },
    }


def build_area_tasks(
    task: ModisTask,
    *,
    start: date,
    end: date,
    regions: tuple[Region, ...] = DEFAULT_REGIONS,
) -> list[dict[str, Any]]:
    """依 `task.parts` 把日期切成以整年為界、首尾相接的幾段，各組一個 task。

    task_name 一律帶整體的結束日，分段時加 `-p<i>of<n>`；年數比 `parts` 少時段數會變少。
    """
    if task.parts == 1:
        return [build_area_task(task, start=start, end=end, regions=regions)]
    years_per_part = -(-(end.year - start.year + 1) // task.parts)
    ranges = []
    for first_year in range(start.year, end.year + 1, years_per_part):
        ranges.append(
            (
                max(start, date(first_year, 1, 1)),
                min(end, date(first_year + years_per_part - 1, 12, 31)),
            )
        )
    tasks = [
        build_area_task(
            task,
            start=part_start,
            end=part_end,
            regions=regions,
            task_name=(
                f"trend-detective-{task.variable_id}-{end:%Y%m%d}"
                f"-p{index}of{len(ranges)}"
            ),
        )
        for index, (part_start, part_end) in enumerate(ranges, start=1)
    ]
    return tasks


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

    def product_layers(self, product: str) -> dict[str, Any]:
        """產品各 layer 的 scale factor、單位、有效範圍等資訊（公開端點）。"""
        return self._request("GET", f"product/{product}").json()

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
    path = raw_dir / variable_id / task_id / SUBMISSION_FILE
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
        if name == SUBMISSION_FILE:  # 不讓 bundle 裡的同名檔蓋掉本地的送件紀錄
            continue
        target = dest / name
        target.write_bytes(client.file_content(task_id, entry["file_id"]))
        saved.append(target)
    return saved


def save_product_info(client: AppeearsClient, raw_dir: Path) -> list[Path]:
    """把送件用到的 layer 的產品資訊存成 `<變數 id>/product.json`。

    這是「統計值已套用 scale factor、單位是什麼」的依據：ValidMin、ValidMax 是套用後的範圍。
    """
    saved = []
    for task in MODIS_TASKS.values():
        layers = client.product_layers(task.product)
        path = raw_dir / task.variable_id / "product.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        info = {
            "product": task.product,
            "layers": {name: layers[name] for name in task.layers},
        }
        path.write_text(
            json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        saved.append(path)
    return saved


def read_token(env_file: Path) -> str:
    return read_secret(
        TOKEN_ENV,
        env_file,
        how_to_get="先用 EDL 帳密呼叫 AppEEARS 的 POST /login 取得 token",
    )


def _submissions(raw_dir: Path) -> list[dict[str, Any]]:
    return [
        json.loads(path.read_text(encoding="utf-8")) | {"dir": path.parent}
        for path in sorted(raw_dir.glob(f"*/*/{SUBMISSION_FILE}"))
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
        # 已送過的 task_name 不重送，中途失敗後可以直接重跑。
        # task_name 含當天日期，所以只在同一天去重；隔天重跑會送出新一批。
        sent = {r["request"]["task_name"] for r in _submissions(args.raw_dir)}
        for task_def in MODIS_TASKS.values():
            for task in build_area_tasks(task_def, start=START_DATE, end=today):
                if task["task_name"] in sent:
                    print(f"{task['task_name']}\t已送過，略過")
                    continue
                task_id = client.submit(task)
                now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
                path = save_submission(
                    args.raw_dir, task_def.variable_id, task_id, task, submitted_at=now
                )
                print(f"{task['task_name']}\t{task_id}\t{now}\t{path}")
        return 0

    if args.command == "download":
        for path in save_product_info(client, args.raw_dir):
            print(f"已存 {path}")
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
