"""從環境變數或本機 `.env` 讀憑證。值只留在記憶體，不寫進任何輸出。"""

import os
from pathlib import Path


def read_secret(name: str, env_file: Path, *, how_to_get: str) -> str:
    """先看環境變數，再看 `.env`；都沒有就結束並說明怎麼取得。"""
    value = os.environ.get(name, "")
    if not value and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, _, raw = line.partition("=")
            if key.strip() == name:
                value = raw.strip().strip("\"'")
    if not value:
        raise SystemExit(f"找不到 {name}。{how_to_get}，以 {name}=… 寫進 {env_file}。")
    return value
