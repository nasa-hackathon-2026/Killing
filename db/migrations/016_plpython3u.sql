-- plpython3u（#91）：在資料庫裡算原始的 Mann-Kendall 檢定與 Sen 斜率。
-- plpython3u 是 untrusted 語言：函式能以資料庫伺服器的作業系統使用者身分執行任何 Python，
-- 所以只有超級使用者（這個容器裡是資料庫擁有者 PGUSER）能建立函式；不要把建立權限給別人。
-- 容器的 Python 沒有 numpy／scipy／pymannkendall，所以是純 Python：只有「原始」MK（含同值
-- 修正的變異數、連續性修正的 Z、常態近似的雙尾 p）與 Sen 斜率；Hamed-Rao 與 Seasonal MK 沒有做。
CREATE EXTENSION IF NOT EXISTS plpython3u;

-- 任意序列：p_years 是時間（年，只給 Sen 斜率用），p_values 是值；兩個陣列等長、依時間排序
CREATE OR REPLACE FUNCTION analysis.mann_kendall_values(
    p_years double precision[], p_values double precision[],
    OUT n integer, OUT s double precision, OUT var_s double precision,
    OUT z double precision, OUT p double precision, OUT tau double precision,
    OUT sen_slope_per_decade double precision)
LANGUAGE plpython3u IMMUTABLE STRICT AS $$
import math
from collections import Counter

values = p_values
years = p_years
count = len(values)
if count != len(years):
    plpy.error("p_years and p_values must have the same length")
if count < 3 or any(v is None for v in values) or any(t is None for t in years):
    return (count, None, None, None, None, None, None)
score = 0
slopes = []
for i in range(count - 1):
    vi, ti = values[i], years[i]
    for j in range(i + 1, count):
        difference = values[j] - vi
        if difference > 0:
            score += 1
        elif difference < 0:
            score -= 1
        if years[j] != ti:
            slopes.append(difference / (years[j] - ti))
ties = sum(t * (t - 1) * (2 * t + 5) for t in Counter(values).values() if t > 1)
variance = (count * (count - 1) * (2 * count + 5) - ties) / 18.0
if variance <= 0:
    z_score = 0.0
elif score > 0:
    z_score = (score - 1) / math.sqrt(variance)
elif score < 0:
    z_score = (score + 1) / math.sqrt(variance)
else:
    z_score = 0.0
p_value = math.erfc(abs(z_score) / math.sqrt(2))
slopes.sort()
half = len(slopes) // 2
if not slopes:
    slope = None
elif len(slopes) % 2:
    slope = slopes[half]
else:
    slope = (slopes[half - 1] + slopes[half]) / 2
return (
    count,
    float(score),
    variance,
    z_score,
    p_value,
    score / (0.5 * count * (count - 1)),
    None if slope is None else 10 * slope,
)
$$;

-- 一條序列：輸入與 trends.py 相同（clean.observations 的月距平，不補值）
CREATE OR REPLACE FUNCTION analysis.mann_kendall(
    p_series_id integer,
    OUT n integer, OUT s double precision, OUT var_s double precision,
    OUT z double precision, OUT p double precision, OUT tau double precision,
    OUT sen_slope_per_decade double precision)
LANGUAGE sql STABLE AS $$
    SELECT (analysis.mann_kendall_values(
        array_agg((extract(year FROM month) * 12 + extract(month FROM month))::double precision / 12
                  ORDER BY month),
        array_agg(anomaly ORDER BY month))).*
    FROM clean.observations
    WHERE series_id = p_series_id AND anomaly IS NOT NULL;
$$;
