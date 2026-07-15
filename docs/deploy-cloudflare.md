# Cloudflare へのデプロイ手順

構成: **Cloudflare Workers**（静的アセット配信 + `/api/settings`）+ **D1**（設定保存）+ **Cloudflare Access**（認証）。

```
ブラウザ ──(Cloudflare Access: メール認証)──> Worker ──┬─ 静的アセット (dist/)
                                                      └─ /api/settings ── D1 (settings / settings_history)
```

デプロイ方法は2通りあります。どちらか一方でOKです。

- **方法A: ブラウザだけで完結（Git連携・推奨）** → このすぐ下
- **方法B: コマンドライン（wrangler CLI）** → 後半

---

# 方法A: ブラウザだけでデプロイ（Git連携）

コマンド入力は不要です。GitHubリポジトリを接続すると、プッシュのたびに自動でビルド＆デプロイされます。

## A-1. D1 データベースを作る

1. https://dash.cloudflare.com にログイン
2. 左メニュー **「ストレージとデータベース（Storage & Databases）」→「D1 SQL データベース」**
3. **「データベースを作成（Create Database）」** → 名前に `shift-craft-db` と入力して作成
4. 作成後の画面に表示される **データベースID（UUID）** をコピーしておく

## A-2. `wrangler.jsonc` にデータベースIDを設定する

GitHub のブラウザ編集で行えます:

1. https://github.com/oshima0627/shift-craft を開き、対象ブランチを選択
2. `wrangler.jsonc` を開いて鉛筆アイコン（Edit）をクリック
3. `"database_id": "REPLACE_WITH_YOUR_DATABASE_ID"` の値を A-1 でコピーしたIDに置き換え
4. 「Commit changes」で保存

## A-3. テーブルを作る（SQLをコンソールで実行）

1. D1 の `shift-craft-db` を開き **「コンソール（Console）」** タブへ
2. 次のSQLを貼り付けて **実行（Execute）**:

```sql
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  json TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
```

3. 「Tables」に `settings` と `settings_history` が表示されればOK

## A-4. Worker を Git 連携で作成する

1. 左メニュー **「Workers & Pages」** → **「作成（Create）」** → **Workers** の **「リポジトリをインポート（Import a repository）」**
2. **GitHubアカウントを接続** し、`oshima0627/shift-craft` を選択
3. 設定画面で:
   - プロジェクト名: `shift-craft`
   - **ビルドコマンド**: `npm run build`
   - **デプロイコマンド**: `npx wrangler deploy`（既定のままでOK）
4. **「保存してデプロイ（Save and Deploy）」**
5. ビルドが完了すると `https://shift-craft.<サブドメイン>.workers.dev` が発行される

> 💡 デプロイ対象のブランチは、作成後に **プロジェクトの Settings → Build →
> ブランチ設定** で変更できます（既定は main）。開発ブランチのままデプロイしたい
> 場合はそこで指定してください。以後、そのブランチにプッシュするたびに自動デプロイされます。

## A-5. Cloudflare Access で保護する（必須・ブラウザのみ）

**この手順を飛ばすと、URLを知っている誰でも設定（スタッフ名・希望休など）を読み書きできてしまいます。**

1. https://one.dash.cloudflare.com （Zero Trust）を開く。初回はチーム名を決める（**Freeプラン**でOK・50ユーザーまで無料）
2. **「Access」→「アプリケーション（Applications）」→「アプリケーションを追加」→「セルフホスト（Self-hosted）」**
3. アプリケーションドメインに Worker のドメインを入力: `shift-craft.<サブドメイン>.workers.dev`（パスは空 = サイト全体）
4. ポリシー作成: アクション **Allow** / 含める条件 **Emails** に自分のメールアドレスを追加 → 保存
5. 「Settings → Authentication」で **One-time PIN** が有効なことを確認（既定で有効）

## A-6. 動作確認

1. 本番URLを開く → メール認証（ワンタイムコード）→ アプリ表示
2. 右上「⋯ データ」→「☁️ クラウドに保存」→ 保存日時が出ればOK
3. 別ブラウザ（同じメールで認証）で「☁️ クラウドから読込」→ 同じ設定が復元される

---

# 方法B: コマンドライン（wrangler CLI）

- Cloudflare アカウント（無料プランでOK）
- Node.js 18+（このリポジトリを clone 済み）

## 1. Wrangler にログイン

```bash
npx -y wrangler login
```

ブラウザが開くので Cloudflare アカウントで許可します。

## 2. D1 データベースを作成

```bash
npx -y wrangler d1 create shift-craft-db
```

出力に含まれる `database_id`（UUID）をコピーし、`wrangler.jsonc` の
`"database_id": "REPLACE_WITH_YOUR_DATABASE_ID"` を置き換えます。

## 3. マイグレーションを適用（テーブル作成）

```bash
npx -y wrangler d1 migrations apply shift-craft-db --remote
```

## 4. デプロイ

```bash
npm run deploy   # = npm run build && wrangler deploy
```

成功すると `https://shift-craft.<あなたのサブドメイン>.workers.dev` が表示されます。

## 5. Cloudflare Access で保護する（必須）

**この手順を飛ばすと、URLを知っている誰でも設定（スタッフ名・希望休など）を読み書きできてしまいます。**
デプロイしたら必ず設定してください。

1. Cloudflare ダッシュボード → **Zero Trust**（初回はチーム名を設定。Freeプランで50ユーザーまで無料）
2. **Access → Applications → Add an application → Self-hosted**
3. Application domain に Worker のドメインを入力
   - `shift-craft.<サブドメイン>.workers.dev`（パスは空 = 全体を保護）
4. ポリシーを作成: Action **Allow** / Include **Emails** に自分のメールアドレスを追加
5. 保存後、サイトにアクセスするとメールにワンタイムコードが届くログイン画面になります

> 補足: workers.dev ドメインを Access で保護する場合、Zero Trust の
> 「Settings → Authentication」で One-time PIN が有効になっていることを確認してください（既定で有効）。
> 独自ドメインを使う場合は Worker にカスタムドメインを割り当ててから、そのドメインで
> Application を作成します。

## 6. 動作確認

1. 本番URLを開く → Access のメール認証 → アプリが表示される
2. 右上「⋯ データ」→「クラウドに保存」→ 保存日時が表示されればOK
3. 別ブラウザ（同じメールで認証）で「クラウドから読込」→ 同じ設定が復元される

## 7. AI解釈を有効にする（任意）

「条件」タブの自由文入力を **Claude（Opus 4.8 / Sonnet 5 を切り替え可能）** で解釈させる機能です。
使う場合のみ、Anthropic の APIキーを **Worker のシークレット** として設定します
（ブラウザ側には保存されません）。未設定でもルールベースの解釈はそのまま使えます。

**コマンドライン（wrangler）:**

```bash
npx -y wrangler secret put ANTHROPIC_API_KEY
# プロンプトに APIキー（sk-ant-... ）を貼り付けて Enter
```

**ダッシュボード:** Workers & Pages → 対象の Worker → **Settings → Variables and Secrets**
→ **Add** → 種類を **Secret** にして、Name: `ANTHROPIC_API_KEY` / Value: APIキー を保存。

設定後は再デプロイ不要で反映されます（次のリクエストから有効）。切り替えたいモデルは
アプリの「条件」タブのプルダウンで選べます（既定は Opus 4.8）。

> APIキーの取得: [Anthropic Console](https://console.anthropic.com/) → API Keys。
> 課金はAPI利用分のみ。解釈1回あたりごく少量のトークンしか使いません。

## 運用メモ

- **同期は明示操作のみ**: 通常の編集はこれまで通り端末内（localStorage）に自動保存され、
  「クラウドに保存/読込」を押したときだけサーバーと同期します。
- **競合防止**: 保存時にサーバー側の更新時刻と照合し、別端末からの保存があった場合は
  「上書きしますか？」と確認します（楽観ロック）。
- **履歴**: 直近20世代を `settings_history` に保持。誤って上書きした場合は
  `npx wrangler d1 execute shift-craft-db --remote --command "SELECT id, saved_at FROM settings_history ORDER BY id DESC"`
  で一覧し、`SELECT json FROM settings_history WHERE id = <ID>` で取り出した JSON を
  「設定をインポート」から復元できます。
- **料金**: Workers/D1/Access とも本アプリの利用規模（管理者1人・数十リクエスト/日）では無料枠内です。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| 「クラウドに接続できませんでした」 | 本番URLで開いているか確認（`npm run dev` のローカルではAPIは動きません） |
| PUT が 500 を返す | 手順3のマイグレーション適用（`--remote` 付き）を忘れていないか確認 |
| Access のログイン画面が出ない | Application domain の綴り、ポリシーの有効化を確認 |
| デプロイで database_id エラー | `wrangler.jsonc` の `database_id` を手順2の値に置き換えたか確認 |
