"""從 Giovanni 的 `/configured-variables/` 產生擴充變數的 seed（#46）。

用法（在 repo 根目錄，`.env` 要有 `EARTHDATA_TOKEN`）：
    uv run python -m trend_detective.variable_list

寫出 `data/seed/variables.extended.json`。哪些產品納入、哪些排除寫在 `PRODUCT_RULES`
（規則是程式，清單是產生出來的資料）。每個變數的英文名稱、單位、產品、DOI、解析度、
來自 `/timeseries` 回應的 metadata；Harmony 的 collection concept id 與產品第一筆資料的日期
（Harmony 不接受更早的起始日）從 CMR 查。
中文名稱、定義、分類由隊伍撰寫：產生時 `name_zh` 暫用英文名、`needs_translation = true`，
重新產生時已填好的中文欄位會保留。
"""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from trend_detective.env import read_secret
from trend_detective.giovanni import GiovanniClient, parse_timeseries_csv

SEED_DIR = Path("data/seed")
EXTENDED_SEED = "variables.extended.json"
CMR_URL = "https://cmr.earthdata.nasa.gov/search/collections.json"
# 取 metadata 用的點位與期間：內陸、各產品都有值的地方；期間短，回應才小
PROBE_LOCATION = (28.61, 77.21)
PROBE_START, PROBE_END = date(2015, 1, 1), date(2015, 3, 31)
# 重新產生時保留的欄位（隊伍手寫的內容）
TEAM_FIELDS = ("name_zh", "definition_zh", "category", "needs_translation", "note_zh")
UNCATEGORISED = "待分類"


@dataclass(frozen=True)
class Rule:
    include: bool
    reason: str
    # 納入的產品才需要：原始時間解析度
    temporal_res: str = ""


# 鍵是變數 id 的開頭（產品，必要時含版本）；比對時取最長的那個。
# 沒有列在這裡的產品一律排除並在報告裡標成「未列入規則」，新產品出現時才不會悄悄混進來。
PRODUCT_RULES: dict[str, Rule] = {
    "GLDAS_NOAH025_M": Rule(True, "全球月資料，0.25°，陸面模式", "month"),
    "AIRS3STM_7": Rule(True, "全球月資料，1°，AIRS-only，現行版本", "month"),
    "M2IMNXASM": Rule(True, "全球月資料，MERRA-2 單層診斷量", "month"),
    "GPM_3IMERGM": Rule(True, "全球月降水", "month"),
    "FLDAS_NOAH01_C_GL_M": Rule(
        True, "全球月資料（南緯 60 度以北），0.1°，MERRA-2 與 CHIRPS 驅動", "month"
    ),
    "OMAERUVd": Rule(True, "OMI 日資料（氣膠）", "day"),
    "OMUVBd": Rule(True, "OMI 日資料（地表紫外線）", "day"),
    "OMTO3d": Rule(True, "OMI 日資料（臭氧總量）", "day"),
    "OMNO2d": Rule(True, "OMI 日資料（二氧化氮）", "day"),
    "OMDOAO3e": Rule(True, "OMI 日資料（DOAS 臭氧總量）", "day"),
    "OMHCHOd": Rule(True, "OMI 日資料（甲醛）", "day"),
    "OMSO2e": Rule(True, "OMI 日資料（二氧化硫）", "day"),
    "OMTO3e": Rule(True, "OMI 日資料（臭氧總量，0.25°）", "day"),
    "FLDAS_NOAH01_CP_GL_M": Rule(
        False,
        "與 FLDAS_NOAH01_C_GL_M 同一組 28 個變數的初步版：以 GDAS 與 CHIRPS-PRELIM 驅動、"
        "只從 2019 年起（CMR 的產品說明）；取 MERRA-2 與 CHIRPS 驅動、從 1982 年起的正式版",
    ),
    "AIRS3STM_006": Rule(False, "舊版本，已由 7.0 取代"),
    "GLDAS_NOAH025_M_2_0": Rule(
        False,
        "2.0 版只涵蓋 1948–2014 年，與 2.1 版（2000 年至今）的驅動資料不同，不可接續",
    ),
    "AIRX3STM": Rule(
        False, "AIRS+AMSU 版本，AMSU-A2 於 2016 年失效後不再延續；變數與 AIRS3STM 重複"
    ),
    "GLDAS_NOAH10_M": Rule(False, "與 GLDAS_NOAH025_M 同模式的 1° 版本，重複"),
    "M2IMNPASM": Rule(False, "氣壓層資料，需要指定層次，單點序列的格式不適用"),
    "TRMM_3B43": Rule(False, "只到 2019 年、只涵蓋南北緯 50 度內，已由 IMERG 取代"),
    "GPCPDAY": Rule(False, "日降水；月降水已有 IMERG，先不收"),
    "GRACEDADM_CLSM025GL": Rule(
        False, "7 日資料，統一格式的轉月規則只定義了日與月（#4），先不收"
    ),
    "GRACEDADM_CLSM0125US": Rule(False, "只涵蓋美國"),
    "FLDAS_NOAHMP001_G_CA_D": Rule(False, "只涵蓋中亞"),
    "NLDAS": Rule(False, "只涵蓋北美"),
    "NCALDAS": Rule(False, "只涵蓋北美"),
    "SMERGE": Rule(False, "只涵蓋美國本土"),
    "AIRS3STD": Rule(False, "AIRS 日資料；本票收月資料版本"),
    "AIRX3STD": Rule(False, "AIRS+AMSU 日資料；本票收月資料版本"),
    "GLDAS_NOAH025_3H": Rule(False, "3 小時資料"),
    "GLDAS_CLSM025": Rule(False, "日資料的陸面模式，本票的陸面量收月資料"),
    "GPM_3IMERGD": Rule(False, "日降水；月降水已有 IMERG 月資料"),
    "GPM_3IMERGHH": Rule(False, "半小時資料"),
    "M2I1": Rule(False, "逐時資料"),
    "M2T1": Rule(False, "逐時資料"),
    "M2SDNXSLV": Rule(False, "MERRA-2 日統計量，本票的 MERRA-2 收月資料"),
    "NOBM": Rule(False, "海洋生地化模式的日資料，不在本票的產品範圍"),
    "OCO2_GEOS_L3CO2_DAY": Rule(False, "OCO-2 同化產品的日資料，不在本票的產品範圍"),
    "TRMM_3B42": Rule(False, "TRMM 日降水，已由 IMERG 取代"),
}
UNLISTED = Rule(False, "未列入規則（Giovanni 新增的產品？請在 PRODUCT_RULES 決定）")


@dataclass
class Selection:
    # (來源變數 id, 規則鍵)
    included: list[tuple[str, str]] = field(default_factory=list)
    # 規則鍵 → 被排除的變數數；沒有對到規則的用變數 id 當鍵
    excluded: dict[str, int] = field(default_factory=dict)
    # 已在核心 seed 的來源變數
    already_core: list[str] = field(default_factory=list)


def rule_key(variable_id: str) -> str | None:
    """變數 id 對到的規則鍵：最長的、在 `_` 邊界上的開頭。對不到回 None。"""
    matches = [
        key
        for key in PRODUCT_RULES
        if variable_id == key
        or variable_id.startswith(key + "_")
        # M2I1、M2T1、GPM_3IMERGD、NLDAS 這類是產品家族的開頭，不在 `_` 邊界上
        or (variable_id.startswith(key) and key in FAMILY_PREFIXES)
    ]
    return max(matches, key=len) if matches else None


FAMILY_PREFIXES = {
    "M2I1",
    "M2T1",
    "GPM_3IMERGD",
    "GPM_3IMERGHH",
    "NLDAS",
    "NCALDAS",
    "SMERGE",
    "GLDAS_CLSM025",
    "NOBM",
}


def select(configured: list[str], core_source_ids: set[str]) -> Selection:
    """依 `PRODUCT_RULES` 把 Giovanni 的變數 id 分成納入、排除、已在核心。"""
    selection = Selection()
    for variable_id in sorted(set(configured)):
        key = rule_key(variable_id)
        if key is None or not PRODUCT_RULES[key].include:
            name = key or variable_id
            selection.excluded[name] = selection.excluded.get(name, 0) + 1
        elif variable_id in core_source_ids:
            selection.already_core.append(variable_id)
        else:
            selection.included.append((variable_id, key))
    return selection


def _collection(cmr: httpx.Client, product: str) -> tuple[str, str] | None:
    """`GLDAS_NOAH025_M.2.1` → CMR 的 (collection concept id, 第一筆資料的日期)；查不到回 None。"""
    short_name, _, version = product.partition(".")
    response = cmr.get(
        CMR_URL,
        params={"short_name": short_name, "version": version, "provider": "GES_DISC"},
    )
    if response.status_code >= 400:
        return None
    entries = response.json().get("feed", {}).get("entry", [])
    if len(entries) != 1:
        return None
    return entries[0]["id"], str(entries[0].get("time_start", ""))[:10]


def build_seed(
    configured: list[str],
    core_variables: list[dict[str, Any]],
    client: GiovanniClient,
    cmr: httpx.Client,
    *,
    existing: list[dict[str, Any]] | None = None,
    workers: int = 8,
) -> tuple[list[dict[str, Any]], Selection, dict[str, str]]:
    """回傳 (seed 條目, 納入與排除的結果, 取不到 metadata 的變數 → 原因)。

    取不到 metadata 的變數不寫進 seed：名稱與單位必須來自實際回應。
    """
    core_ids = {v["source_variable_id"] for v in core_variables}
    selection = select(configured, core_ids)
    kept = {item["id"]: item for item in existing or []}
    failures: dict[str, str] = {}

    def probe(item: tuple[str, str]) -> dict[str, Any] | None:
        source_id, key = item
        try:
            text, _ = client.fetch_timeseries(
                source_id,
                lat=PROBE_LOCATION[0],
                lon=PROBE_LOCATION[1],
                start=PROBE_START,
                end=PROBE_END,
            )
            meta = parse_timeseries_csv(text)
        except Exception as err:  # noqa: BLE001 單一變數失敗不中斷整份清單
            failures[source_id] = f"{type(err).__name__}: {err}"[:300]
            return None
        if not meta.product or not meta.param_name:
            failures[source_id] = "回應的 metadata 沒有 prod_name 或 param_name"
            return None
        entry: dict[str, Any] = {
            "id": source_id.lower(),
            "name_zh": meta.param_name,
            "name_en": meta.param_name,
            "definition_zh": "",
            "category": UNCATEGORISED,
            "needs_translation": True,
            "tier": "extended",
            "source": "giovanni",
            "source_variable_id": source_id,
            "product": meta.product,
            "product_version": meta.product.partition(".")[2],
            "native_temporal_res": PRODUCT_RULES[key].temporal_res,
            "is_nasa": True,
            "doi": meta.doi,
            "source_long_name": meta.param_name,
            "unit": meta.unit,
            "lat_resolution": meta.lat_resolution,
            "lon_resolution": meta.lon_resolution,
        }
        previous = kept.get(entry["id"], {})
        for name in TEAM_FIELDS:
            if name in previous:
                entry[name] = previous[name]
        return entry

    with ThreadPoolExecutor(max_workers=workers) as pool:
        entries = [e for e in pool.map(probe, selection.included) if e is not None]
    collections: dict[str, tuple[str, str] | None] = {}
    for entry in entries:
        product = entry["product"]
        if product not in collections:
            collections[product] = _collection(cmr, product)
        found = collections[product]
        if found is not None:
            entry["harmony_collection"], entry["data_start"] = found
    return entries, selection, failures


def report(selection: Selection, failures: dict[str, str]) -> str:
    """納入與排除的產品及理由，貼到票上用。"""
    lines = ["納入："]
    counts: dict[str, int] = {}
    for _, key in selection.included:
        counts[key] = counts.get(key, 0) + 1
    for key, count in sorted(counts.items()):
        lines.append(f"  {key} × {count}：{PRODUCT_RULES[key].reason}")
    lines.append(f"已在核心 seed、不重複：{len(selection.already_core)} 個")
    lines.append("排除：")
    for key, count in sorted(selection.excluded.items()):
        rule = PRODUCT_RULES.get(key, UNLISTED)
        lines.append(f"  {key} × {count}：{rule.reason}")
    if failures:
        lines.append(f"取不到 metadata、沒有寫進 seed：{len(failures)} 個")
        for source_id, reason in sorted(failures.items()):
            lines.append(f"  {source_id}：{reason}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="產生擴充變數的 seed")
    parser.add_argument("--seed-dir", type=Path, default=SEED_DIR)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args(argv)
    token = read_secret(
        "EARTHDATA_TOKEN",
        args.env_file,
        how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
    )
    client = GiovanniClient(token, quota_ttl=60, retries=4)
    http = httpx.Client(timeout=120, headers={"Authorization": f"Bearer {token}"})
    listing = http.get(
        "https://api.giovanni.earthdata.nasa.gov/configured-variables/"
    ).json()
    configured = (
        listing["configured_variables"] if isinstance(listing, dict) else listing
    )
    core = json.loads((args.seed_dir / "variables.json").read_text(encoding="utf-8"))
    out = args.seed_dir / EXTENDED_SEED
    existing = json.loads(out.read_text(encoding="utf-8")) if out.exists() else []
    entries, selection, failures = build_seed(
        configured,
        core,
        client,
        httpx.Client(timeout=60),
        existing=existing,
        workers=args.workers,
    )
    out.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{out}：{len(entries)} 個變數（Giovanni 共 {len(configured)} 個）")
    print(report(selection, failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
