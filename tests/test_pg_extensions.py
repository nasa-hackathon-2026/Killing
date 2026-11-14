"""`pg_extensions` 裡不連資料庫的部分。連資料庫的整合測試在 `test_pg.py`。"""

import numpy as np

from trend_detective import pg_extensions


def test_raster_rows_run_north_to_south_with_missing_as_none() -> None:
    values = np.array([[1.0, 2.0], [3.0, np.nan]])  # 第一列是最南邊
    rows = pg_extensions._rows(values, np.isnan(values))
    assert rows == [[3.0, None], [1.0, 2.0]]


def test_components_label_each_node_with_the_smallest_member() -> None:
    labels = pg_extensions.components(
        [1, 2, 3, 4, 5, 6], [(2, 3), (3, 1), (5, 4), (1, 2)]
    )
    assert labels == {1: 1, 2: 1, 3: 1, 4: 4, 5: 4, 6: 6}


def test_every_listed_extension_names_an_object_to_count() -> None:
    names = {name for name, _, _ in pg_extensions.EXTENSION_OBJECTS}
    assert {
        "postgis_raster", "ltree", "vector", "h3", "h3_postgis", "timescaledb_toolkit",
        "pgrouting", "tablefunc", "plpython3u", "pg_textsearch", "file_fdw", "pg_cron",
        "btree_gist", "unit",
    } <= names  # fmt: skip
