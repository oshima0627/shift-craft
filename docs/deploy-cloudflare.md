# Cloudflare へのデプロイ手順

構成: **Cloudflare Workers**（静的アセット配信 + `/api/settings`）+ **D1**（設定保存）+ **Cloudflare Access**（認証）。

```
ブラウザ ──(Cloudflare Access: メール認証)──> Worker ──┬─ 静的アセット (dist/)
                                                      └─ /api/settings ── D1 (settings / settings_history)
```

## 前提

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
2. 右上「⋯ データ」→「☁️ クラウドに保存」→ 保存日時が表示されればOK
3. 別ブラウザ（同じメールで認証）で「☁️ クラウドから読込」→ 同じ設定が復元される

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
