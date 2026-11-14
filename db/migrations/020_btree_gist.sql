-- btree_gist（#91）。
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- btree_gist：同一個變數（同一種聚合方式）「會標月份」的已知問題，期間不得重疊。
-- 重疊的話同一個月會被兩筆問題各標一次，摘要裡的月數會重複計算；seed 寫錯時在載入就擋下來。
-- 排除約束要同時比「相等」（文字欄）與「重疊」（期間），所以需要 btree_gist 讓 GiST 支援文字的 =。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'known_issues_no_overlap') THEN
        ALTER TABLE meta.known_issues ADD CONSTRAINT known_issues_no_overlap
            EXCLUDE USING gist (
                variable_id WITH =,
                (coalesce(aggregation, '*')) WITH =,
                daterange(period_start, period_end, '[]') WITH &&)
            WHERE (flag_months AND variable_id IS NOT NULL);
    END IF;
END $$;
