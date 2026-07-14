-- 設定の現在値（単一店舗前提: id=1 の1行のみ）
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 保存履歴（誤上書きからの復元用。直近20件をWorker側で保持）
CREATE TABLE IF NOT EXISTS settings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  json TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
