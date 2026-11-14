"""送件用的資料清單：由目錄檔產生，NASA 資料與其他來源分開。"""

from trend_detective.data_lists import render_nasa_data, render_references

CATALOG = {
    "variables": [
        {
            "id": "omi_no2",
            "name_en": "Tropospheric NO2 column (OMI)",
            "product": "OMNO2d.003",
            "product_version": "003",
            "doi": "10.5067/Aura/OMI/DATA3007",
            "source": "giovanni",
            "valid_from": "2004-10-01",
            "valid_to": "2026-03-01",
            "is_nasa": True,
        },
        {
            "id": "station_temp",
            "name_en": "Station air temperature (NOAA GHCNh)",
            "product": "GHCNh",
            "source": "noaa_ghcnh",
            "valid_from": "2000-01-01",
            "valid_to": "2026-10-01",
            "is_nasa": False,
            "citation": "NOAA NCEI GHCNh, accessed via AWS Open Data.",
        },
        {
            "id": "unused",
            "name_en": "Never fetched",
            "product": "X.1",
            "source": "giovanni",
            "valid_from": None,
            "valid_to": None,
            "is_nasa": True,
        },
    ],
    "series": [
        {"variable_id": "omi_no2", "location_id": "taichung", "aggregation": "point"},
        {"variable_id": "omi_no2", "location_id": "taiwan", "aggregation": "area_mean"},
        {"variable_id": "station_temp", "location_id": "s1", "aggregation": "station"},
    ],
    "snapshot": {"generated_at": "2026-11-14T08:00:00Z", "latest_month": {}},
}


def test_nasa_list_gives_product_version_period_doi_and_how_it_was_accessed():
    text = render_nasa_data(CATALOG)

    row = next(line for line in text.splitlines() if "OMNO2d.003" in line)
    assert "Tropospheric NO2 column (OMI)" in row
    assert "2004-10 to 2026-03" in row
    assert "https://doi.org/10.5067/Aura/OMI/DATA3007" in row
    assert "NASA Giovanni" in row and "Harmony" in row  # 有點位也有區域平均
    assert "2026-11-14" in text  # 快照日


def test_nasa_list_leaves_out_non_nasa_data_and_variables_without_any_series():
    text = render_nasa_data(CATALOG)

    assert "GHCNh" not in text
    assert "Never fetched" not in text


def test_references_list_non_nasa_data_with_its_citation_and_the_packages_used():
    text = render_references(CATALOG, ["httpx>=0.28.1"])

    assert "Station air temperature (NOAA GHCNh)" in text
    assert "NOAA NCEI GHCNh, accessed via AWS Open Data." in text
    assert "2000-01 to 2026-10" in text
    assert "httpx" in text
    assert "OMNO2d" not in text
