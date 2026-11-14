"""由各產品的實際變數清單產生格點 seed（`data/seed/grids.extended.json`）。

用法（在 repo 根目錄，`.env` 要有 `EARTHDATA_TOKEN`）：

    uv run python -m trend_detective.grid_catalog

要列哪些產品寫在 `data/seed/grid_products.json`（short name、版本、id 前綴，以及哪幾個
變數是核心變數、它們的前端衍生檔設定）。其餘都從資料來：

- collection 的 concept id、DOI、引用資訊、起始月：CMR 的 collection metadata。
- 變數清單、單位、長名稱：該產品最新一個 granule 的 OPeNDAP DMR（檔案實際的結構）。
  只收「去掉長度 1 的時間軸之後，剛好是 緯度 × 經度」的數值變數；有氣壓層等其他維度的
  （AIRS 的剖面）不適用於 (時間, 緯度, 經度) 立方體，不列入。
- 中文名稱、定義、分類不在這裡編寫：id 與 `data/seed/variables.json` 相同的核心變數沿用
  那裡的名稱，其餘 `name_zh` 暫用英文名並標 `needs_translation: true`。

座標值指的是格子的哪裡，DMR 看不出來：AIRS 經 OPeNDAP 得到的 `YDim`／`XDim` 是格子的
北緣與西緣而不是中心（實測），所以在設定檔替該產品寫 `cell_reference`，照抄到每個條目。

日資料產品（OMI）在設定檔寫 `temporal: "day"`；`only_core: true` 表示只列核心變數
（OMNO2d 0.25° 的日資料每個變數全期約 18 GB，其餘變數先不抓）。

`data/seed/grids.json` 已有的（collection、變數）不重複列。
"""

import argparse
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from trend_detective.env import read_secret

CMR = "https://cmr.earthdata.nasa.gov/search"
CONFIG_FILE = Path("data/seed/grid_products.json")
EXISTING_FILE = Path("data/seed/grids.json")
NAMES_FILE = Path("data/seed/variables.json")
OUT_FILE = Path("data/seed/grids.extended.json")
DAP = "{http://xml.opendap.org/ns/DAP/4.0#}"
NUMERIC = ("Float", "Int", "UInt", "Byte")
LAT_UNITS = {"degrees_north", "degree_north"}
LON_UNITS = {"degrees_east", "degree_east"}


class CatalogError(RuntimeError):
    """CMR 或 DMR 的內容不符合預期。訊息不含憑證。"""


@dataclass(frozen=True)
class GridVariable:
    """DMR 裡一個 緯度 × 經度 的變數。路徑都以 `/` 開頭。"""

    path: str
    lat: str
    lon: str
    unit: str
    long_name: str


def _attributes(node: ET.Element) -> dict[str, str]:
    found = {}
    for attribute in node.findall(DAP + "Attribute"):
        value = attribute.find(DAP + "Value")
        if value is not None:
            text = value.text if value.text is not None else value.get("value", "")
            found[attribute.get("name", "")] = " ".join(text.split())
    return found


def grid_variables(dmr_xml: str) -> list[GridVariable]:
    """從 DMR 找出所有 緯度 × 經度 的數值變數，依路徑排序。

    維度的身分看同名的座標變數的單位（`degrees_north`／`degrees_east`），不看名稱，
    所以 `lat`／`lon`、`Y`／`X`、`YDim`／`XDim` 都認得，軸的順序也不限。
    """
    sizes: dict[str, int] = {}
    variables: list[tuple[str, list[str], dict[str, str]]] = []

    def walk(node: ET.Element, prefix: str) -> None:
        for child in node:
            tag = child.tag.removeprefix(DAP)
            name = child.get("name", "")
            if tag == "Dimension":
                sizes[f"{prefix}/{name}"] = int(child.get("size", "0"))
            elif tag == "Group":
                walk(child, f"{prefix}/{name}")
            elif tag.startswith(NUMERIC):
                dims = [dim.get("name", "") for dim in child.findall(DAP + "Dim")]
                variables.append((f"{prefix}/{name}", dims, _attributes(child)))

    walk(ET.fromstring(dmr_xml), "")
    units = {path: attrs.get("units", "") for path, _, attrs in variables}
    found = []
    for path, dims, attrs in variables:
        axes = [dim for dim in dims if sizes.get(dim) != 1]
        lat = [dim for dim in axes if units.get(dim) in LAT_UNITS]
        lon = [dim for dim in axes if units.get(dim) in LON_UNITS]
        if len(axes) != 2 or len(lat) != 1 or len(lon) != 1:
            continue
        found.append(
            GridVariable(
                path=path,
                lat=lat[0],
                lon=lon[0],
                unit=attrs.get("units") or attrs.get("Units") or "",
                long_name=attrs.get("long_name")
                or attrs.get("LongName")
                or attrs.get("Title")
                or "",
            )
        )
    return sorted(found, key=lambda variable: variable.path)


def citation(umm: dict[str, Any], doi: str) -> str:
    """把 CMR 的 CollectionCitations 排成一行引用文字（欄位照 CMR，不另外編寫）。"""
    cited = (umm.get("CollectionCitations") or [{}])[0]
    year = str(cited.get("ReleaseDate", ""))[:4]
    parts = [
        f"{cited.get('Creator', '')} ({year})" if year else cited.get("Creator", ""),
        cited.get("Title") or umm.get("EntryTitle", ""),
        cited.get("ReleasePlace", ""),
        cited.get("Publisher", ""),
        f"doi:{doi}" if doi else "",
    ]
    return ", ".join(part.strip() for part in parts if part and part.strip())


def entries(
    config: dict[str, Any],
    collection: dict[str, Any],
    variables: list[GridVariable],
    *,
    names: dict[str, dict[str, Any]],
    existing: set[tuple[str, str]],
) -> list[dict[str, Any]]:
    """一個產品的 seed 條目：核心變數在前，其餘依路徑排序。

    `collection` 是 CMR `collections.umm_json` 的一個 item；`names` 是
    `variables.json` 依 id 查的名稱；`existing` 是已在別的 seed 檔的（collection, 變數名）。
    """
    umm, concept = collection["umm"], collection["meta"]["concept-id"]
    doi = (umm.get("DOI") or {}).get("DOI", "")
    begin = umm["TemporalExtents"][0]["RangeDateTimes"][0]["BeginningDateTime"]
    shared = {
        "product": f"{umm['ShortName']}.{umm['Version']}",
        "product_version": umm["Version"],
        "collection": concept,
        "doi": doi,
        "citation": citation(umm, doi),
        "start": begin[:7],
    }
    core: dict[str, dict[str, Any]] = config.get("core", {})
    missing = set(core) - {variable.path for variable in variables}
    if missing:
        raise CatalogError(
            f"{shared['product']} 的檔案裡沒有核心變數 {sorted(missing)}"
        )
    result = []
    for variable in sorted(variables, key=lambda v: (v.path not in core, v.path)):
        leaf = variable.path.rsplit("/", 1)[-1]
        if (concept, leaf) in existing:
            continue
        if config.get("only_core") and variable.path not in core:
            continue
        chosen = core.get(variable.path, {})
        slug = re.sub(r"[^a-z0-9]+", "_", leaf.lower()).strip("_")
        ident = chosen.get("id") or f"{config['prefix']}_{slug}"
        known = names.get(ident)
        fallback = f"{variable.long_name} ({leaf})" if variable.long_name else leaf
        entry: dict[str, Any] = {
            "id": ident,
            "name_zh": known["name_zh"] if known else fallback,
            "name_en": known["name_en"] if known else fallback,
            "needs_translation": known is None,
            "long_name": variable.long_name,
            "unit": variable.unit or chosen.get("unit", ""),
            **shared,
            "variable": variable.path,
            "lat": variable.lat,
            "lon": variable.lon,
        }
        for key in ("cell_reference", "temporal"):
            if key in config:
                entry[key] = config[key]
        if "frontend" in chosen:
            entry["frontend"] = chosen["frontend"]
        result.append(entry)
    return result


def check_unique(seed: list[dict[str, Any]], taken: set[str]) -> None:
    seen = set(taken)
    for entry in seed:
        if entry["id"] in seen:
            raise CatalogError(f"id 重複：{entry['id']}")
        seen.add(entry["id"])


def fetch_collection(http: httpx.Client, short_name: str, version: str) -> Any:
    response = http.get(
        f"{CMR}/collections.umm_json",
        params={"short_name": short_name, "version": version},
    )
    items = response.json().get("items", []) if response.status_code == 200 else []
    if len(items) != 1:
        raise CatalogError(
            f"CMR 查 {short_name} {version}：HTTP {response.status_code}，"
            f"{len(items)} 個 collection"
        )
    return items[0]


def fetch_dmr(http: httpx.Client, token: str, concept: str) -> str:
    """最新一個 granule 的 DMR。"""
    response = http.get(
        f"{CMR}/granules.umm_json",
        params={
            "collection_concept_id": concept,
            "sort_key": "-start_date",
            "page_size": 1,
        },
    )
    items = response.json().get("items", []) if response.status_code == 200 else []
    urls = [
        link["URL"]
        for item in items
        for link in item["umm"].get("RelatedUrls", [])
        if link.get("Subtype") == "OPENDAP DATA"
    ]
    if not urls:
        raise CatalogError(f"CMR 查不到 {concept} 的 OPeNDAP 網址")
    dmr = http.get(urls[0] + ".dmr.xml", headers={"Authorization": f"Bearer {token}"})
    if dmr.status_code != 200 or "<Dataset" not in dmr.text[:2000]:
        raise CatalogError(f"{concept} 的 DMR → HTTP {dmr.status_code}")
    return dmr.text


def build_seed(
    http: httpx.Client,
    token: str,
    configs: list[dict[str, Any]],
    *,
    names: dict[str, dict[str, Any]],
    existing_seed: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    existing = {
        (entry["collection"], entry["variable"].rsplit("/", 1)[-1])
        for entry in existing_seed
    }
    seed: list[dict[str, Any]] = []
    for config in configs:
        collection = fetch_collection(http, config["short_name"], config["version"])
        variables = grid_variables(
            fetch_dmr(http, token, collection["meta"]["concept-id"])
        )
        seed += entries(config, collection, variables, names=names, existing=existing)
    check_unique(seed, {entry["id"] for entry in existing_seed})
    return seed


def main() -> None:
    parser = argparse.ArgumentParser(description="由產品的實際變數清單產生格點 seed")
    parser.add_argument("--config", type=Path, default=CONFIG_FILE)
    parser.add_argument("--existing", type=Path, default=EXISTING_FILE)
    parser.add_argument("--names", type=Path, default=NAMES_FILE)
    parser.add_argument("--out", type=Path, default=OUT_FILE)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    args = parser.parse_args()
    token = read_secret(
        "EARTHDATA_TOKEN",
        args.env_file,
        how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
    )
    names = {
        entry["id"]: entry
        for entry in json.loads(args.names.read_text(encoding="utf-8"))
    }
    with httpx.Client(timeout=120, follow_redirects=True) as http:
        seed = build_seed(
            http,
            token,
            json.loads(args.config.read_text(encoding="utf-8")),
            names=names,
            existing_seed=json.loads(args.existing.read_text(encoding="utf-8")),
        )
    args.out.write_text(
        json.dumps(seed, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    counts: dict[str, int] = {}
    for entry in seed:
        counts[entry["product"]] = counts.get(entry["product"], 0) + 1
    for product, count in counts.items():
        print(f"{product}：{count} 個變數")
    print(f"寫出 {args.out}（{len(seed)} 筆）")


if __name__ == "__main__":
    main()
