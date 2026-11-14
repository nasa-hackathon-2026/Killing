"""由目錄檔產生送件用的資料清單（英文，給送件表單的 NASA Data 與 References 欄位）。

用法（在 repo 根目錄）：
    uv run python -m trend_detective.data_lists

快照指令跑完也會自動更新這兩份檔。內容只來自 `data/snapshot/catalog.json` 與 `pyproject.toml`，
所以清單與目錄檔一致；要改內容請改 seed 後重新產生快照，不要手改這兩份檔。
"""

import argparse
import json
import sys
import tomllib
from pathlib import Path
from typing import Any

SNAPSHOT_DIR = Path("data/snapshot")
OUT_DIR = Path("docs/data")
NASA_FILE = "nasa-data.md"
REFERENCES_FILE = "references.md"

ACCESS = {
    ("giovanni", "point"): "NASA Giovanni time-series API (point)",
    ("giovanni", "area_mean"): "NASA Harmony / Giovanni Averaging Service (area mean)",
    ("nasa_power", "point"): "NASA POWER Monthly API (point)",
    ("appeears", "area_mean"): "NASA AppEEARS area request (area statistics)",
    ("noaa_ghcnh", "station"): "AWS Open Data (NOAA NODD)",
}


def _cell(text: object) -> str:
    """表格儲存格：`|` 與換行會讓 Markdown 表格錯欄，先處理掉。"""
    return str(text or "").replace("|", "\\|").replace("\n", " ").strip()


def _period(variable: dict[str, Any]) -> str:
    start, end = variable.get("valid_from"), variable.get("valid_to")
    return f"{start[:7]} to {end[:7]}" if start and end else "n/a"


def _used(
    catalog: dict[str, Any], *, nasa: bool
) -> list[tuple[dict[str, Any], list[str]]]:
    """實際有序列的變數，以及它們是怎麼取得的。"""
    rows = []
    for variable in catalog["variables"]:
        if bool(variable.get("is_nasa")) != nasa:
            continue
        kinds = sorted(
            {
                s["aggregation"]
                for s in catalog["series"]
                if s["variable_id"] == variable["id"]
            },
            reverse=True,
        )
        if not kinds:
            continue
        access = [
            ACCESS.get((variable["source"], kind), f"{variable['source']} ({kind})")
            for kind in kinds
        ]
        rows.append((variable, access))
    return rows


def render_nasa_data(catalog: dict[str, Any]) -> str:
    """本作品使用的 NASA 資料：產品、版本、期間、DOI、取得管道。"""
    snapshot_day = catalog["snapshot"]["generated_at"][:10]
    lines = [
        "# NASA data used in this project",
        "",
        (
            f"Generated from `data/snapshot/catalog.json` (snapshot date {snapshot_day}). "
            "Do not edit by hand; run `uv run python -m trend_detective.data_lists`."
        ),
        "",
        (
            "All series are stored as monthly values for points and regions in Taiwan. "
            "Units are kept as provided by each product."
        ),
        "",
        "| Variable | NASA product | Version | Period | Accessed via | DOI / citation |",
        "|---|---|---|---|---|---|",
    ]
    for variable, access in _used(catalog, nasa=True):
        doi = variable.get("doi")
        reference = f"https://doi.org/{doi}" if doi else variable.get("citation", "")
        lines.append(
            f"| {_cell(variable.get('name_en', variable['id']))} | {_cell(variable.get('product'))} "
            f"| {_cell(variable.get('product_version'))} | {_period(variable)} "
            f"| {'; '.join(access)} | {_cell(reference)} |"
        )
    return "\n".join(lines) + "\n"


def render_references(catalog: dict[str, Any], packages: list[str]) -> str:
    """非 NASA 的資料來源與使用的套件。"""
    lines = [
        "# References: non-NASA data and software",
        "",
        "Generated from `data/snapshot/catalog.json` and `pyproject.toml`. Do not edit by hand.",
        "",
        "## Non-NASA data",
        "",
        "| Variable | Source | Period | Accessed via | Citation |",
        "|---|---|---|---|---|",
    ]
    for variable, access in _used(catalog, nasa=False):
        lines.append(
            f"| {_cell(variable.get('name_en', variable['id']))} | {_cell(variable.get('product'))} "
            f"| {_period(variable)} | {'; '.join(access)} | {_cell(variable.get('citation'))} |"
        )
    lines += [
        "",
        "## Software",
        "",
        "Python packages the data pipeline depends on:",
        "",
    ]
    lines += [f"- `{package}`" for package in packages]
    lines += ["- Python standard library (`sqlite3`, `csv`, `json`)"]
    return "\n".join(lines) + "\n"


def write_lists(snapshot_dir: Path, out_dir: Path, pyproject: Path) -> list[Path]:
    """寫出兩份清單；內容沒變就不動檔案。"""
    catalog = json.loads((snapshot_dir / "catalog.json").read_text(encoding="utf-8"))
    packages = tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"][
        "dependencies"
    ]
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, text in (
        (NASA_FILE, render_nasa_data(catalog)),
        (REFERENCES_FILE, render_references(catalog, packages)),
    ):
        path = out_dir / name
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="由目錄檔產生送件用的資料清單")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--pyproject", type=Path, default=Path("pyproject.toml"))
    args = parser.parse_args(argv)
    for path in write_lists(args.snapshot_dir, args.out_dir, args.pyproject):
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
