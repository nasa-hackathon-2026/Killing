"""變數的分類樹（#91）：`meta.variables.category_path`（PostgreSQL 的 ltree）由這裡的規則算出。

規則是資料：`data/seed/variable_taxonomy.json`。核心變數逐一寫在 `core`（人工指定）；其餘變數依序
比對 `rules`，規則裡有的鍵都要符合，先符合的為準；都不符合就是 `unclassified`。純函式，不連資料庫。
"""

import json
import re
from pathlib import Path
from typing import Any

TAXONOMY_SEED = Path("data/seed/variable_taxonomy.json")
UNCLASSIFIED = "unclassified"
BASIS_MANUAL = "manual"
# ltree 的標籤：字母、數字、底線；路徑用點分隔
PATH_PATTERN = re.compile(r"^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$")
RULE_KEYS = {
    "variable_pattern": "id",
    "name_pattern": "name_en",
    "product_pattern": "product",
    "unit_pattern": "unit",
}


class TaxonomyError(ValueError):
    """分類規則檔的內容不合法。"""


def load_taxonomy(path: Path = TAXONOMY_SEED) -> dict[str, Any]:
    taxonomy = json.loads(path.read_text(encoding="utf-8"))
    validate(taxonomy)
    return taxonomy


def validate(taxonomy: dict[str, Any]) -> None:
    """路徑要是合法的 ltree；規則至少要有一個比對條件，而且只能用認得的鍵。"""
    paths = [
        *taxonomy.get("core", {}).values(),
        *(rule.get("path") for rule in taxonomy.get("rules", [])),
        taxonomy.get("unclassified", UNCLASSIFIED),
    ]
    for path in paths:
        if not isinstance(path, str) or not PATH_PATTERN.match(path):
            raise TaxonomyError(f"不是合法的 ltree 路徑：{path!r}")
    for rule in taxonomy.get("rules", []):
        keys = set(rule) - {"path", "note"}
        if not keys or not keys <= set(RULE_KEYS):
            raise TaxonomyError(f"規則的鍵不對：{sorted(rule)}")


def category_for(variable: dict[str, Any], taxonomy: dict[str, Any]) -> tuple[str, str]:
    """回傳 (ltree 路徑, 依據)。依據是 `manual`、`rule:<第幾條，從 1 起>` 或 `unclassified`。"""
    variable_id = variable.get("id") or ""
    manual = taxonomy.get("core", {}).get(variable_id)
    if manual is not None:
        return manual, BASIS_MANUAL
    for number, rule in enumerate(taxonomy.get("rules", []), start=1):
        for key, field in RULE_KEYS.items():
            if key not in rule:
                continue
            flags = re.IGNORECASE if key == "name_pattern" else 0
            if not re.search(rule[key], variable.get(field) or "", flags):
                break
        else:
            return rule["path"], f"rule:{number}"
    unclassified = taxonomy.get("unclassified", UNCLASSIFIED)
    return unclassified, UNCLASSIFIED


def classify(
    variables: list[dict[str, Any]], taxonomy: dict[str, Any]
) -> dict[str, tuple[str, str]]:
    return {v["id"]: category_for(v, taxonomy) for v in variables}
