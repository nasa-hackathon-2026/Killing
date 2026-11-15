"""欄位參考產生器（#121）：說明檔的合併與 Markdown 產生是純函式，不連資料庫。"""

import pytest

from trend_detective.pg_schema_doc import (
    UNDOCUMENTED,
    Column,
    Function,
    Relation,
    Snapshot,
    merge,
    parse_notes,
    render,
)


def _snapshot() -> Snapshot:
    return Snapshot(
        relations=(
            Relation(
                schema="clean",
                name="observations",
                kind="table",
                columns=(
                    Column("series_id", "integer", False),
                    Column("qc_flag", "text", False),
                    Column("anomaly", "double precision", True, comment="a | b"),
                ),
                n_rows=2379422,
                primary_key="series_id, month",
                constraints=("FOREIGN KEY (series_id) REFERENCES meta.series(series_id)",),
                indexes=("clean_observations_flagged USING btree (qc_flag)",),
            ),
            Relation(
                schema="analysis",
                name="mining_wide_point",
                kind="table",
                columns=(
                    Column("location_id", "text", False),
                    Column("gldas_tair", "double precision", True),
                ),
                n_rows=1260,
            ),
            Relation(schema="cron", name="job", kind="table", extension="pg_cron"),
        ),
        functions=(
            Function("obs", "missing_months", "", "TABLE(series_id integer)", "plpgsql"),
        ),
        extensions=(("timescaledb", "2.32.0"),),
        server_version="PostgreSQL 17.11",
        database_size="2762 MB",
        last_run=("derive", "2026-11-14 22:51 UTC", "fd4e4f0b1f97"),
    )  # fmt: skip


NOTES = {
    "_readme": "不算說明",
    "clean.observations": {
        "desc": "清洗結果。",
        "source": "pg clean",
        "trust": "imputed",
    },
    "clean.observations.series_id": "序列。",
    "clean.observations.qc_flag": {
        "desc": "品質旗標。",
        "values": {"ok": "沒有問題", "missing": "缺月"},
    },
    "analysis.mining_wide_point": "探勘寬表。",
    "analysis.mining_wide_point.*": "欄名是變數 id。",
    "obs.missing_months()": "缺月骨架。",
    "clean.gone.column": "這個欄位已經不在資料庫。",
}


def test_parse_notes_accepts_strings_and_objects_and_skips_underscore_keys() -> None:
    notes = parse_notes(NOTES)
    assert "_readme" not in notes
    assert notes["clean.observations.series_id"].desc == "序列。"
    assert notes["clean.observations"].trust == "imputed"
    assert notes["clean.observations.qc_flag"].values == {
        "ok": "沒有問題",
        "missing": "缺月",
    }


@pytest.mark.parametrize(
    "bad",
    [
        {"a.b": {"source": "沒有 desc"}},
        {"a.b": {"desc": "x", "trust": "certain"}},
        {"a.b": {"desc": "x", "sorce": "拼錯的欄位"}},
        {"a.b": 3},
    ],
)
def test_parse_notes_rejects_malformed_entries(bad: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        parse_notes(bad)


def test_merge_reports_undocumented_and_stale_keys() -> None:
    merged = merge(_snapshot(), parse_notes(NOTES))
    # 資料庫有、說明檔沒有：只有 anomaly；寬表的欄位由 `.*` 涵蓋；擴充的表不要求說明
    assert merged.undocumented == ("clean.observations.anomaly",)
    # 說明檔有、資料庫沒有
    assert merged.stale == ("clean.gone.column",)


def test_merge_with_no_notes_lists_every_own_object() -> None:
    merged = merge(_snapshot(), {})
    assert "clean.observations" in merged.undocumented
    assert "analysis.mining_wide_point.gldas_tair" in merged.undocumented
    assert "obs.missing_months()" in merged.undocumented
    assert not any(key.startswith("cron.") for key in merged.undocumented)


def test_render_marks_undocumented_and_lists_them_at_the_end() -> None:
    snapshot = _snapshot()
    text = render(
        snapshot, merge(snapshot, parse_notes(NOTES)), intro="## 導讀\n\n手寫。"
    )
    assert text.startswith("# 清洗資料庫的表與欄位參考\n")
    assert "不要手改" in text
    assert "`derive`，2026-11-14 22:51 UTC，當時的 commit `fd4e4f0`" in text
    assert "`clean.observations` 2,379,422" in text
    assert text.index("## 導讀") < text.index("## 逐表欄位清單")
    # 表：種類、列數、主鍵、來源與性質
    assert "表｜2,379,422 列｜主鍵 `series_id, month`" in text
    assert "- **寫入**：pg clean" in text
    assert "含補值" in text
    # 欄位：列舉值展開；沒說明的標出來，COMMENT 裡的 | 不會破壞表格
    assert (
        "| `qc_flag` | `text` | 否 | 品質旗標。值：`ok`：沒有問題；`missing`：缺月。 |"
        in text
    )
    assert (
        "| `anomaly` | `double precision` | 是 | 資料庫的 COMMENT：a \\| b。 |" in text
    )
    assert "| `gldas_tair` | `double precision` | 是 | 欄名是變數 id。 |" in text
    assert (
        "| `obs.missing_months()` | `TABLE(series_id integer)` | plpgsql | 缺月骨架。 |"
        in text
    )
    # 擴充自帶的物件只列名稱
    assert "| `cron.job` | 表 | `pg_cron` | — |" in text
    assert "### `cron.job`" not in text
    tail = text[text.index("## 還沒有說明的物件") :]
    assert "- `clean.observations.anomaly`" in tail
    assert UNDOCUMENTED not in text[: text.index("## 還沒有說明的物件")].replace(
        f"標「{UNDOCUMENTED}」", ""
    )  # fmt: skip


def test_render_is_deterministic_and_says_so_when_everything_is_documented() -> None:
    snapshot = _snapshot()
    notes = parse_notes({**NOTES, "clean.observations.anomaly": "月距平。"})
    first = render(snapshot, merge(snapshot, notes))
    assert first == render(snapshot, merge(snapshot, notes))
    assert "沒有：資料庫裡本專案的表、欄位與函式在 notes 檔都有說明。" in first
