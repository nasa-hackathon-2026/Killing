"""產生清洗資料庫的表與欄位參考（#121）：`docs/data/database-schema.md`。

    uv run python -m trend_detective.pg_schema_doc --out docs/data/database-schema.md

資料庫只知道結構（欄位、型別、鍵、索引、列數），不知道欄位的意義。意義寫在人工維護的說明檔
`docs/data/database-schema.notes.json`，這個模組把兩者合併成 Markdown：

- 說明檔的鍵：`schema.table`、`schema.table.column`、`schema.function()`；某張表的欄位隨資料
  而定時（探勘寬表）可用 `schema.table.*` 當該表所有欄位的預設說明。
- 值是一句說明（字串），或物件 `{"desc", "source", "trust", "values"}`：`source` 是由哪個指令
  或程式寫入，`trust` 是 `raw`／`derived`／`imputed`／`analysis`，`values` 是列舉值的意義。
- 資料庫的 `COMMENT ON` 有寫時一併列出；說明檔優先。
- 說明檔有、資料庫沒有的鍵會印警告；資料庫有、說明檔沒有的在輸出標「（未說明）」並列在結尾。

輸出可重現：檔頭的時間是資料庫最後一筆 `analysis.runs` 的完成時間，不是現在時間；同一個
資料庫狀態重跑兩次，輸出逐位元組相同。只做 SELECT。擴充套件自帶的物件（`cron.job`、
`public.spatial_ref_sys`…）只列名稱，不列欄位。
"""

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql

from trend_detective import pg

OUT_FILE = Path("docs/data/database-schema.md")
NOTES_FILE = Path("docs/data/database-schema.notes.json")
INTRO_FILE = Path("docs/data/database-schema.intro.md")
UNDOCUMENTED = "（未說明）"
TRUST_LABELS = {
    "raw": "原始（來源給的值，沒有改過）",
    "derived": "衍生（由原始值照固定規則算出，可重算）",
    "imputed": "含補值（有些值是補出來的，不是觀測）",
    "analysis": "分析結果（統計或探勘的輸出，隨參數而變）",
}
KIND_LABELS = {
    "table": "表",
    "hypertable": "表（TimescaleDB hypertable）",
    "view": "view",
    "materialized view": "materialized view",
    "continuous aggregate": "view（TimescaleDB continuous aggregate）",
    "foreign table": "foreign table（查詢時才讀外部檔案）",
}
SYSTEM_SCHEMAS = ("pg_catalog", "information_schema", "pg_toast")


@dataclass(frozen=True)
class Column:
    name: str
    type: str
    nullable: bool
    comment: str | None = None
    generated: bool = False


@dataclass(frozen=True)
class Relation:
    schema: str
    name: str
    kind: str  # KIND_LABELS 的鍵
    columns: tuple[Column, ...] = ()
    comment: str | None = None
    n_rows: int | None = None
    primary_key: str | None = None
    constraints: tuple[str, ...] = ()  # 外鍵、CHECK、UNIQUE、EXCLUDE 的定義
    indexes: tuple[str, ...] = ()
    extension: str | None = None  # 屬於哪個擴充套件；None 是專案自己的

    @property
    def key(self) -> str:
        return f"{self.schema}.{self.name}"


@dataclass(frozen=True)
class Function:
    schema: str
    name: str
    arguments: str
    returns: str
    language: str
    comment: str | None = None

    @property
    def key(self) -> str:
        return f"{self.schema}.{self.name}()"


@dataclass(frozen=True)
class Snapshot:
    """資料庫在某個時間點的結構。"""

    relations: tuple[Relation, ...]
    functions: tuple[Function, ...] = ()
    extensions: tuple[tuple[str, str], ...] = ()
    server_version: str = ""
    database_size: str = ""
    last_run: tuple[str, str, str | None] | None = None  # (step, 完成時間, git commit)


@dataclass(frozen=True)
class Note:
    desc: str
    source: str | None = None
    trust: str | None = None
    values: dict[str, str] = field(default_factory=dict[str, str])


@dataclass(frozen=True)
class Merged:
    """說明檔與資料庫結構比對的結果。"""

    notes: dict[str, Note]
    undocumented: tuple[str, ...]  # 資料庫有、說明檔沒有
    stale: tuple[str, ...]  # 說明檔有、資料庫沒有


# ---------------------------------------------------------------- 純函式：說明檔


def parse_notes(raw: dict[str, Any]) -> dict[str, Note]:
    """說明檔的內容 → `{鍵: Note}`。以 `_` 開頭的鍵是檔案自己的註解，略過。"""
    notes: dict[str, Note] = {}
    for key, value in raw.items():
        if key.startswith("_"):
            continue
        if isinstance(value, str):
            notes[key] = Note(value)
            continue
        if not isinstance(value, dict) or "desc" not in value:
            raise ValueError(f"{key}: 值要是字串，或有 desc 的物件")
        unknown = set(value) - {"desc", "source", "trust", "values"}
        if unknown:
            raise ValueError(f"{key}: 不認得的欄位 {sorted(unknown)}")
        trust = value.get("trust")
        if trust is not None and trust not in TRUST_LABELS:
            raise ValueError(f"{key}: trust 要是 {sorted(TRUST_LABELS)} 之一")
        notes[key] = Note(
            value["desc"], value.get("source"), trust, dict(value.get("values") or {})
        )
    return notes


def column_note(notes: dict[str, Note], relation: Relation, column: str) -> Note | None:
    """欄位的說明：先找 `schema.table.column`，再找 `schema.table.*`。"""
    return notes.get(f"{relation.key}.{column}") or notes.get(f"{relation.key}.*")


def merge(snapshot: Snapshot, notes: dict[str, Note]) -> Merged:
    """比對說明檔與資料庫：哪些物件沒有說明、哪些說明的對象已經不在資料庫。"""
    used: set[str] = set()
    undocumented: list[str] = []
    for relation in snapshot.relations:
        if relation.extension is not None:
            continue
        if relation.key in notes:
            used.add(relation.key)
        else:
            undocumented.append(relation.key)
        wildcard = f"{relation.key}.*"
        for column in relation.columns:
            exact = f"{relation.key}.{column.name}"
            if exact in notes:
                used.add(exact)
            elif wildcard in notes:
                used.add(wildcard)
            else:
                undocumented.append(exact)
    for function in snapshot.functions:
        if function.key in notes:
            used.add(function.key)
        else:
            undocumented.append(function.key)
    stale = sorted(set(notes) - used)
    return Merged(notes, tuple(undocumented), tuple(stale))


# ---------------------------------------------------------------- 純函式：Markdown


def _cell(text: str) -> str:
    """表格儲存格：`|` 與換行會破壞 Markdown 表格。"""
    return text.replace("|", "\\|").replace("\n", " ")


def _number(value: int) -> str:
    return f"{value:,}"


def _described(note: Note | None, comment: str | None) -> str:
    """一個欄位或物件的說明文字：說明檔優先，另附資料庫的 COMMENT。"""
    parts: list[str] = []
    if note is not None:
        parts.append(note.desc)
        if note.values:
            listed = "；".join(f"`{k}`：{v}" for k, v in note.values.items())
            parts.append(f"值：{listed}")
        if note.source:
            parts.append(f"寫入：{note.source}")
        if note.trust:
            parts.append(f"性質：{TRUST_LABELS[note.trust]}")
    if comment:
        parts.append(f"資料庫的 COMMENT：{comment}")
    return (
        "。".join(part.rstrip("。") for part in parts) + "。" if parts else UNDOCUMENTED
    )


def render_relation(relation: Relation, notes: dict[str, Note]) -> list[str]:
    lines = [f"### `{relation.key}`", ""]
    facts = [KIND_LABELS[relation.kind]]
    if relation.n_rows is not None:
        facts.append(f"{_number(relation.n_rows)} 列")
    if relation.primary_key:
        facts.append(f"主鍵 `{relation.primary_key}`")
    lines += ["｜".join(facts), ""]
    note = notes.get(relation.key)
    if note is None and not relation.comment:
        lines += [UNDOCUMENTED, ""]
    else:
        if note is not None:
            lines += [note.desc, ""]
            if note.values:
                lines += [f"- `{k}`：{v}" for k, v in note.values.items()] + [""]
            if note.source:
                lines += [f"- **寫入**：{note.source}"]
            if note.trust:
                lines += [f"- **性質**：{TRUST_LABELS[note.trust]}"]
            if note.source or note.trust:
                lines += [""]
        if relation.comment:
            lines += [f"資料庫的 COMMENT：{relation.comment}", ""]
    if relation.columns:
        lines += ["| 欄位 | 型別 | 可空 | 說明 |", "|---|---|---|---|"]
        for column in relation.columns:
            kind = column.type + ("（generated）" if column.generated else "")
            text = _described(column_note(notes, relation, column.name), column.comment)
            lines.append(
                f"| `{column.name}` | `{_cell(kind)}` |"
                f" {'是' if column.nullable else '否'} | {_cell(text)} |"
            )
        lines.append("")
    if relation.constraints:
        lines += ["約束："] + [f"- `{item}`" for item in relation.constraints] + [""]
    if relation.indexes:
        lines += ["索引："] + [f"- `{item}`" for item in relation.indexes] + [""]
    return lines


def render_header(snapshot: Snapshot) -> list[str]:
    counts = {r.key: r.n_rows for r in snapshot.relations if r.n_rows is not None}
    headline = [
        f"`{key}` {_number(counts[key])}"
        for key in (
            "meta.series",
            "meta.variables",
            "obs.observations",
            "clean.observations",
            "analysis.trends",
            "analysis.model_obs_pairs",
        )
        if key in counts
    ]
    lines = [
        (
            "> 本檔由 `uv run python -m trend_detective.pg_schema_doc` 產生。**不要手改**："
            "欄位的說明改 `docs/data/database-schema.notes.json`，導讀改"
            " `docs/data/database-schema.intro.md`，再重跑。"
        ),
        ">",
    ]
    if snapshot.last_run is not None:
        step, finished, commit = snapshot.last_run
        lines.append(
            f"> 資料庫狀態：最後一筆執行紀錄（`analysis.runs`）是 `{step}`，{finished}"
            f"，當時的 commit `{(commit or '未記錄')[:7]}`。"
        )
    if headline:
        lines.append(f"> 列數：{'、'.join(headline)}。")
    lines.append(
        f"> 伺服器：{snapshot.server_version}；資料庫大小 {snapshot.database_size}。"
    )
    return lines


def render(snapshot: Snapshot, merged: Merged, intro: str = "") -> str:
    """整份 Markdown。`intro` 是手寫的導讀（原樣放在檔頭之後）。"""
    notes = merged.notes
    lines = ["# 清洗資料庫的表與欄位參考", "", *render_header(snapshot), ""]
    if intro.strip():
        lines += [intro.strip(), ""]
    own = [r for r in snapshot.relations if r.extension is None]
    n_columns = sum(len(r.columns) for r in own)
    lines += [
        "## 逐表欄位清單",
        "",
        (
            f"以下由資料庫自動讀出：{len(own)} 個表與 view、{n_columns} 個欄位、"
            f"{len(snapshot.functions)} 個函式；說明來自 notes 檔。"
            f"標「{UNDOCUMENTED}」的是 notes 檔還沒寫到的，清單在文末。"
        ),
        "",
    ]
    schemas = [r.schema for r in own] + [f.schema for f in snapshot.functions]
    for schema in dict.fromkeys(schemas):
        relations = [r for r in own if r.schema == schema]
        lines += [f"## schema `{schema}`", ""]
        if relations:
            lines += ["| 物件 | 種類 | 列數 |", "|---|---|---|"]
            for r in relations:
                n = _number(r.n_rows) if r.n_rows is not None else "—"
                lines.append(f"| `{r.key}` | {KIND_LABELS[r.kind]} | {n} |")
            lines.append("")
        for relation in relations:
            lines += render_relation(relation, notes)
        functions = [f for f in snapshot.functions if f.schema == schema]
        if functions:
            lines += [f"### `{schema}` 的函式", ""]
            lines += ["| 函式 | 回傳 | 語言 | 說明 |", "|---|---|---|---|"]
            for f in functions:
                text = _described(notes.get(f.key), f.comment)
                lines.append(
                    f"| `{f.schema}.{f.name}({_cell(f.arguments)})` |"
                    f" `{_cell(f.returns)}` | {f.language} | {_cell(text)} |"
                )
            lines.append("")
    lines += ["## 已安裝的擴充套件", "", "| 擴充 | 版本 |", "|---|---|"]
    lines += [f"| `{name}` | {version} |" for name, version in snapshot.extensions]
    lines.append("")
    foreign = [r for r in snapshot.relations if r.extension is not None]
    if foreign:
        lines += [
            "## 擴充套件自帶的物件",
            "",
            "不是本專案建的，只列名稱；欄位見各擴充的文件。",
            "",
            "| 物件 | 種類 | 擴充 | 列數 |",
            "|---|---|---|---|",
        ]
        for r in foreign:
            n = _number(r.n_rows) if r.n_rows is not None else "—"
            lines.append(
                f"| `{r.key}` | {KIND_LABELS[r.kind]} | `{r.extension}` | {n} |"
            )
        lines.append("")
    lines += ["## 還沒有說明的物件", ""]
    if merged.undocumented:
        lines += [f"- `{key}`" for key in merged.undocumented]
    else:
        lines.append("沒有：資料庫裡本專案的表、欄位與函式在 notes 檔都有說明。")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- 讀資料庫（只做 SELECT）

RELATIONS_SQL = """
SELECT c.oid, n.nspname, c.relname, c.relkind::text,
       obj_description(c.oid, 'pg_class'),
       (SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname <> ALL (%s)
  AND n.nspname NOT LIKE '\\_timescaledb%%' AND n.nspname NOT LIKE 'pg\\_temp%%'
  AND n.nspname NOT LIKE 'pg\\_toast%%'
ORDER BY array_position(%s, n.nspname::text), n.nspname, c.relname
"""
COLUMNS_SQL = """
SELECT a.attrelid, a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
       col_description(a.attrelid, a.attnum), a.attgenerated <> ''
FROM pg_attribute a
WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attrelid = ANY (%s)
ORDER BY a.attrelid, a.attnum
"""
CONSTRAINTS_SQL = """
SELECT conrelid, contype::text, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = ANY (%s) AND contype IN ('p', 'f', 'c', 'u', 'x')
ORDER BY conrelid, contype, conname
"""
INDEXES_SQL = """
SELECT i.indrelid, pg_get_indexdef(i.indexrelid)
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = ANY (%s) AND NOT i.indisprimary
ORDER BY i.indrelid, c.relname
"""
FUNCTIONS_SQL = """
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
       pg_get_function_result(p.oid), l.lanname, obj_description(p.oid, 'pg_proc')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = ANY (%s) AND p.prokind IN ('f', 'p')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
ORDER BY array_position(%s, n.nspname::text), p.proname, 3
"""


def _timescale_objects(
    conn: psycopg.Connection[Any],
) -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    """(hypertable, continuous aggregate) 的 (schema, 名稱)；沒裝 TimescaleDB 就是空的。"""
    installed = conn.execute(
        "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'"
    ).fetchone()
    if installed is None:
        return set(), set()
    hypertables = {
        (row[0], row[1])
        for row in conn.execute(
            "SELECT hypertable_schema, hypertable_name FROM timescaledb_information.hypertables"
        )
    }
    aggregates = {
        (row[0], row[1])
        for row in conn.execute(
            "SELECT view_schema, view_name FROM timescaledb_information.continuous_aggregates"
        )
    }
    return hypertables, aggregates


def _index_summary(definition: str) -> str:
    """`CREATE INDEX name ON schema.table USING …` → `name USING …`。"""
    head, _, rest = definition.partition(" USING ")
    name = head.split(" ON ")[0].replace("CREATE UNIQUE INDEX ", "UNIQUE ")
    return f"{name.replace('CREATE INDEX ', '')} USING {rest}"


def collect(conn: psycopg.Connection[Any], *, count_rows: bool = True) -> Snapshot:
    """從 `pg_catalog` 讀出結構。列數用 `count(*)`（foreign table 與一般 view 不數）。"""
    order = list(pg.SCHEMAS)
    rows = conn.execute(RELATIONS_SQL, (list(SYSTEM_SCHEMAS), order)).fetchall()
    oids = [row[0] for row in rows]
    columns: dict[int, list[Column]] = {}
    for oid, name, kind, nullable, comment, generated in conn.execute(
        COLUMNS_SQL, (oids,)
    ):
        columns.setdefault(oid, []).append(
            Column(name, kind, nullable, comment, generated)
        )
    primary: dict[int, str] = {}
    constraints: dict[int, list[str]] = {}
    for oid, kind, definition in conn.execute(CONSTRAINTS_SQL, (oids,)):
        if kind == "p":
            primary[oid] = definition.removeprefix("PRIMARY KEY ").strip("()")
        else:
            constraints.setdefault(oid, []).append(definition)
    indexes: dict[int, list[str]] = {}
    for oid, definition in conn.execute(INDEXES_SQL, (oids,)):
        indexes.setdefault(oid, []).append(_index_summary(definition))
    hypertables, aggregates = _timescale_objects(conn)
    relations: list[Relation] = []
    for oid, schema, name, relkind, comment, extension in rows:
        if (schema, name) in hypertables:
            kind = "hypertable"
        elif (schema, name) in aggregates:
            kind = "continuous aggregate"
        else:
            kind = {
                "r": "table",
                "p": "table",
                "v": "view",
                "m": "materialized view",
                "f": "foreign table",
            }[relkind]
        n_rows = None
        if count_rows and kind not in ("view", "foreign table"):
            counted = conn.execute(
                sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(schema, name))
            ).fetchone()
            n_rows = int(counted[0]) if counted else None
        relations.append(
            Relation(
                schema=schema,
                name=name,
                kind=kind,
                columns=tuple(columns.get(oid, [])) if extension is None else (),
                comment=comment,
                n_rows=n_rows,
                primary_key=primary.get(oid),
                constraints=tuple(constraints.get(oid, [])),
                indexes=tuple(indexes.get(oid, [])),
                extension=extension,
            )
        )
    functions = tuple(
        Function(*row) for row in conn.execute(FUNCTIONS_SQL, (order, order))
    )
    extensions = tuple(
        (row[0], row[1])
        for row in conn.execute(
            "SELECT extname, extversion FROM pg_extension ORDER BY extname"
        )
    )
    version = conn.execute("SHOW server_version").fetchone()
    size = conn.execute(
        "SELECT pg_size_pretty(pg_database_size(current_database()))"
    ).fetchone()
    last_run = None
    if conn.execute("SELECT to_regclass('analysis.runs')").fetchone() != (None,):
        last_run = conn.execute(
            "SELECT step, to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI \"UTC\"'),"
            " git_commit FROM analysis.runs ORDER BY finished_at DESC, run_id DESC LIMIT 1"
        ).fetchone()
    return Snapshot(
        relations=tuple(relations),
        functions=functions,
        extensions=extensions,
        server_version=f"PostgreSQL {version[0].split(' ')[0]}" if version else "",
        database_size=size[0] if size else "",
        last_run=(last_run[0], last_run[1], last_run[2]) if last_run else None,
    )


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_FILE)
    parser.add_argument("--notes", type=Path, default=NOTES_FILE)
    parser.add_argument(
        "--intro", type=Path, default=INTRO_FILE, help="手寫的導讀（Markdown）"
    )
    parser.add_argument("--env-file", type=Path, default=pg.ENV_FILE)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="有未說明的物件或過期的說明就以 exit code 1 結束",
    )
    args = parser.parse_args(argv)
    notes = parse_notes(json.loads(args.notes.read_text(encoding="utf-8")))
    intro = args.intro.read_text(encoding="utf-8") if args.intro.exists() else ""
    with pg.connect(args.env_file) as conn:
        conn.read_only = True
        snapshot = collect(conn)
    merged = merge(snapshot, notes)
    args.out.write_text(render(snapshot, merged, intro), encoding="utf-8")
    own = [r for r in snapshot.relations if r.extension is None]
    print(
        f"{args.out}：{len(own)} 個表與 view、{sum(len(r.columns) for r in own)} 個欄位、"
        f"{len(snapshot.functions)} 個函式；未說明 {len(merged.undocumented)}、"
        f"過期的說明 {len(merged.stale)}"
    )
    for key in merged.stale:
        print(f"警告：說明檔有、資料庫沒有：{key}", file=sys.stderr)
    for key in merged.undocumented:
        print(f"未說明：{key}", file=sys.stderr)
    return 1 if args.strict and (merged.undocumented or merged.stale) else 0


if __name__ == "__main__":
    raise SystemExit(main())
