"""擴充變數清單的產生器：納入與排除規則，以及 seed 條目的內容來自來源回應。不連網。"""

import httpx

from trend_detective.giovanni import GiovanniClient
from trend_detective.variable_list import build_seed, report, select

SECRET = "secret-token-value"
# #46 的要求：這些產品納入
WANTED = [
    "GLDAS_NOAH025_M_2_1_Qs_acc",
    "AIRS3STM_7_0_CloudFrc_A",
    "M2IMNXASM_5_12_4_QV2M",
    "GPM_3IMERGM_07_precipitationQualityIndex",
    "FLDAS_NOAH01_C_GL_M_001_Evap_tavg",
    "OMAERUVd_003_FinalAerosolAbsOpticalDepth388",
    "OMUVBd_003_UVindex",
    "OMTO3d_003_UVAerosolIndex",
    "OMNO2d_003_ColumnAmountNO2Trop",
]
# #46 的要求：只涵蓋北美或區域的產品，以及逐時、3 小時產品，排除
UNWANTED = [
    "NLDAS_NOAH0125_M_2_0_Evap",
    "NLDAS_FORA0125_H_2_0_Tair",
    "NCALDAS_NOAH0125_D_2_0_Evap",
    "FLDAS_NOAHMP001_G_CA_D_001_Evap_tavg",
    "GRACEDADM_CLSM0125US_7D_4_0_gws_inst",
    "GLDAS_NOAH025_3H_2_1_Tair_f_inst",
    "M2T1NXSLV_5_12_4_T2M",
    "GPM_3IMERGHH_07_precipitation",
]
CORE = "GLDAS_NOAH025_M_2_1_Tair_f_inst"


def _metadata_csv(product: str, name: str, unit: str) -> str:
    return (
        f"prod_name,{product}\ndoi,10.5067/EXAMPLE\nparam_name,{name}\nunit,{unit}\n"
        "undef,-9999\nlat,28.625\nlon,77.125\nlat_resolution,0.25\nlon_resolution,0.25\n\n"
        "Timestamp (UTC),Data\n2015-01-01 00:00,1.5\n"
    )


def _clients(missing: str = "") -> tuple[GiovanniClient, httpx.Client]:
    def giovanni(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        variable = request.url.params["data"]
        if variable == missing:
            return httpx.Response(404, text="Data was not found")
        return httpx.Response(
            200,
            text=_metadata_csv(
                "GLDAS_NOAH025_M.2.1", f"Long name of {variable}", "kg m-2"
            ),
        )

    def cmr(request: httpx.Request) -> httpx.Response:
        assert request.url.params["short_name"] == "GLDAS_NOAH025_M"
        assert request.url.params["version"] == "2.1"
        entry = {"id": "C42-GES_DISC", "time_start": "2000-01-01T00:00:00.000Z"}
        return httpx.Response(200, json={"feed": {"entry": [entry]}})

    http = httpx.Client(
        transport=httpx.MockTransport(giovanni), base_url="https://giovanni.test/"
    )
    return (
        GiovanniClient(token=SECRET, http=http),
        httpx.Client(transport=httpx.MockTransport(cmr)),
    )


def test_global_monthly_and_omi_daily_products_are_included_and_the_rest_excluded():
    selection = select([*WANTED, *UNWANTED], core_source_ids=set())

    assert sorted(source_id for source_id, _ in selection.included) == sorted(WANTED)
    assert sum(selection.excluded.values()) == len(UNWANTED)


def test_a_variable_already_in_the_core_seed_is_not_listed_again():
    selection = select([CORE, WANTED[0]], core_source_ids={CORE})

    assert [source_id for source_id, _ in selection.included] == [WANTED[0]]
    assert selection.already_core == [CORE]


def test_superseded_versions_and_duplicate_resolutions_are_excluded():
    selection = select(
        [
            "AIRS3STM_006_CloudFrc_A",
            "GLDAS_NOAH025_M_2_0_Tair_f_inst",
            "GLDAS_NOAH10_M_2_1_Tair_f_inst",
            "FLDAS_NOAH01_CP_GL_M_001_Evap_tavg",
        ],
        core_source_ids=set(),
    )

    assert selection.included == []


def test_a_product_nobody_decided_on_is_excluded_and_named_in_the_report():
    selection = select(["BRANDNEW_L3_1_0_thing"], core_source_ids=set())

    assert selection.included == []
    assert "BRANDNEW_L3_1_0_thing" in report(selection, {})
    assert "未列入規則" in report(selection, {})


def test_seed_entry_takes_names_unit_product_and_collection_from_the_responses():
    client, cmr = _clients()

    entries, _, failures = build_seed(
        ["GLDAS_NOAH025_M_2_1_Qs_acc"], [], client, cmr, workers=2
    )

    assert failures == {}
    (entry,) = entries
    assert entry["id"] == "gldas_noah025_m_2_1_qs_acc"
    assert entry["source_variable_id"] == "GLDAS_NOAH025_M_2_1_Qs_acc"
    assert entry["name_en"] == "Long name of GLDAS_NOAH025_M_2_1_Qs_acc"
    assert entry["unit"] == "kg m-2"
    assert entry["product"] == "GLDAS_NOAH025_M.2.1"
    assert entry["product_version"] == "2.1"
    assert entry["doi"] == "10.5067/EXAMPLE"
    assert entry["harmony_collection"] == "C42-GES_DISC"
    assert entry["data_start"] == "2000-01-01"
    assert entry["native_temporal_res"] == "month"
    assert entry["source"] == "giovanni"


def test_chinese_text_is_left_marked_for_the_team_instead_of_being_made_up():
    client, cmr = _clients()

    entries, _, _ = build_seed(["GLDAS_NOAH025_M_2_1_Qs_acc"], [], client, cmr)

    (entry,) = entries
    assert entry["needs_translation"] is True
    assert entry["name_zh"] == entry["name_en"]
    assert entry["definition_zh"] == ""
    assert entry["category"] == "待分類"


def test_regenerating_keeps_the_chinese_text_the_team_already_wrote():
    client, cmr = _clients()
    written = {
        "id": "gldas_noah025_m_2_1_qs_acc",
        "name_zh": "地表逕流",
        "definition_zh": "下雨後沒有滲進土裡、直接流走的水。",
        "category": "水（液態）",
        "needs_translation": False,
    }

    entries, _, _ = build_seed(
        ["GLDAS_NOAH025_M_2_1_Qs_acc"], [], client, cmr, existing=[written]
    )

    (entry,) = entries
    assert {key: entry[key] for key in written} == written
    assert entry["unit"] == "kg m-2"


def test_a_variable_whose_metadata_cannot_be_fetched_is_reported_not_written():
    bad = "GLDAS_NOAH025_M_2_1_Qsb_acc"
    client, cmr = _clients(missing=bad)

    entries, _, failures = build_seed(
        ["GLDAS_NOAH025_M_2_1_Qs_acc", bad], [], client, cmr
    )

    assert [entry["source_variable_id"] for entry in entries] == [
        "GLDAS_NOAH025_M_2_1_Qs_acc"
    ]
    assert list(failures) == [bad]
    assert "404" in failures[bad]
