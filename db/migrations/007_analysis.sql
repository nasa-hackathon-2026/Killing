-- 每次執行的紀錄（載入、清洗、趨勢、探勘）
CREATE TABLE IF NOT EXISTS analysis.runs (
    run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    step text NOT NULL,
    started_at timestamptz NOT NULL,
    finished_at timestamptz NOT NULL,
    git_commit text,
    parameters jsonb NOT NULL DEFAULT '{}',
    rows_affected jsonb NOT NULL DEFAULT '{}',
    note text
);
