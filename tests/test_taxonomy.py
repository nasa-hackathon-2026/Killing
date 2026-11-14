"""變數分類規則（ltree 路徑）的純函式測試；不連資料庫。"""

import json
from pathlib import Path

import pytest

from trend_detective import taxonomy

SEED_DIR = Path(__file__).parent.parent / "data" / "seed"
RULES = {
    "unclassified": "unclassified",
    "core": {"gldas_tair": "atmosphere.temperature.near_surface"},
    "rules": [
        {"variable_pattern": "_ct$", "path": "auxiliary.count"},
        {
            "product_pattern": "^GLDAS",
            "variable_pattern": "soilmoi",
            "path": "land.water.soil_moisture",
        },
        {"name_pattern": "ozone", "unit_pattern": "^DU$", "path": "atmosphere.gas.o3"},
        {"unit_pattern": "^K$", "path": "atmosphere.temperature.other"},
    ],
}


def test_core_variables_are_assigned_by_hand_before_any_rule() -> None:
    variable = {"id": "gldas_tair", "unit": "K", "product": "GLDAS_NOAH025_M.2.1"}
    assert taxonomy.category_for(variable, RULES) == (
        "atmosphere.temperature.near_surface",
        "manual",
    )


def test_first_matching_rule_wins_and_every_key_must_match() -> None:
    def path(**variable: str) -> tuple[str, str]:
        return taxonomy.category_for(variable, RULES)

    # 輔助量的規則排在前面：名稱裡也有 soilmoi，但先符合 _ct$
    assert path(id="gldas_soilmoi_ct", product="GLDAS_X") == (
        "auxiliary.count",
        "rule:1",
    )
    assert path(id="gldas_soilmoi0_10cm", product="GLDAS_X") == (
        "land.water.soil_moisture",
        "rule:2",
    )
    # 產品不符合就不算
    assert path(id="fldas_soilmoi0_10cm", product="FLDAS_X") == (
        "unclassified",
        "unclassified",
    )
    # 英文名不分大小寫；單位也要符合
    assert (
        path(id="x", name_en="Total Column Ozone", unit="DU")[0] == "atmosphere.gas.o3"
    )
    assert (
        path(id="x", name_en="Total Column Ozone", unit="kg m-2")[0] == "unclassified"
    )
    assert path(id="y", unit="K") == ("atmosphere.temperature.other", "rule:4")


def test_invalid_paths_and_rules_are_rejected() -> None:
    with pytest.raises(taxonomy.TaxonomyError):
        taxonomy.validate({"core": {"x": "land.water-soil"}})
    with pytest.raises(taxonomy.TaxonomyError):
        taxonomy.validate({"rules": [{"path": "land"}]})
    with pytest.raises(taxonomy.TaxonomyError):
        taxonomy.validate({"rules": [{"id_pattern": "x", "path": "land"}]})


def test_seed_assigns_every_core_variable_by_hand() -> None:
    rules = taxonomy.load_taxonomy(SEED_DIR / "variable_taxonomy.json")
    variables = json.loads((SEED_DIR / "variables.json").read_text(encoding="utf-8"))
    variables = variables["variables"] if isinstance(variables, dict) else variables
    assigned = taxonomy.classify(variables, rules)
    assert len(assigned) == 16
    assert {basis for _, basis in assigned.values()} == {"manual"}
    assert assigned["omi_no2"][0] == "atmosphere.gas.no2"
    assert assigned["gldas_soilmoist"][0] == "land.water.soil_moisture"
    assert assigned["modis_ndvi"][0] == "land.vegetation.ndvi"


def test_seed_rules_classify_the_generated_extended_variables() -> None:
    rules = taxonomy.load_taxonomy(SEED_DIR / "variable_taxonomy.json")
    content = json.loads(
        (SEED_DIR / "variables.extended.json").read_text(encoding="utf-8")
    )
    variables = content["variables"] if isinstance(content, dict) else content
    assigned = taxonomy.classify(variables, rules)
    unclassified = [v for v, (path, _) in assigned.items() if path == "unclassified"]
    assert unclassified == []
    assert (
        assigned["fldas_noah01_c_gl_m_001_soilmoi00_10cm_tavg"][0]
        == "land.water.soil_moisture"
    )
    # 輔助量（格點 seed 才有的變數）先於物理量的規則
    for variable_id, path in (
        ("merra2_var_t2m", "auxiliary.variance"),
        ("airs_surfairtemp_tqj_a_ct", "auxiliary.count"),
        ("airs_toto3_d_sdev", "auxiliary.sdev"),
        ("omto3d_solarzenithangle", "auxiliary.geometry"),
    ):
        assert taxonomy.category_for({"id": variable_id}, rules)[0] == path
    assert (
        assigned["omto3d_003_radiativecloudfraction"][0] == "atmosphere.cloud.fraction"
    )
