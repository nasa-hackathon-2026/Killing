"""欄位參考產生器讀資料庫的部分（#121）。需要容器；連不上時整個檔跳過。只讀正式資料庫的結構，不寫入。"""

import json
from pathlib import Path

import pytest

from trend_detective import pg, pg_schema_doc

pytestmark = [
    pytest.mark.pg,
    pytest.mark.skipif(
        not pg.database_available(), reason="沒有可連線的 PostgreSQL 容器"
    ),
]
ROOT = Path(__file__).parent.parent


def test_collect_reads_structure_and_the_notes_file_has_no_stale_keys() -> None:
    with pg.connect(pg.ENV_FILE) as conn:
        conn.read_only = True
        if conn.execute("SELECT to_regclass('clean.observations')").fetchone() == (
            None,
        ):
            pytest.skip("資料庫還沒有載入")
        snapshot = pg_schema_doc.collect(conn, count_rows=False)
    by_key = {relation.key: relation for relation in snapshot.relations}
    assert by_key["obs.observations"].kind == "hypertable"
    assert by_key["obs.yearly_mean"].kind == "continuous aggregate"
    assert by_key["clean.monthly_climatology"].kind == "materialized view"
    assert by_key["clean.observations"].primary_key == "series_id, month"
    assert [c.name for c in by_key["clean.observations"].columns][:3] == [
        "series_id",
        "month",
        "in_source",
    ]
    assert by_key["public.spatial_ref_sys"].extension == "postgis"
    assert any(f.key == "obs.missing_months()" for f in snapshot.functions)
    notes = pg_schema_doc.parse_notes(
        json.loads((ROOT / pg_schema_doc.NOTES_FILE).read_text(encoding="utf-8"))
    )
    merged = pg_schema_doc.merge(snapshot, notes)
    # 說明檔寫到的表、欄位、函式都要真的在資料庫裡
    assert merged.stale == ()
