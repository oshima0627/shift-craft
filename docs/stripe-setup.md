# Stripe 月額課金の有効化手順

ShiftCraft の課金機能は **Stripe** で動きます。コードは実装済みで、以下の設定を行うと有効になります（未設定でも他機能は通常どおり動作します）。

## プラン仕様
- 月額 **¥1,480 / 月**
- 年額 **¥14,800 / 年**（2ヶ月分お得）
- 新規登録ユーザーは **14日間の無料トライアル**（フル機能）
- トライアル終了後（未加入）は **AI解釈・CSV出力／印刷などのオプション機能がロック**（シフト作成・編集・閲覧は無料で継続可）
- 既存ユーザー・運営者アカウントは `comp`（無料招待）として自動的にフルアクセス

## 1. Stripe 側の準備
1. [Stripe ダッシュボード](https://dashboard.stripe.com/) でアカウント作成（日本・JPY）。
2. **商品（Product）を作成** し、価格（Price）を2つ追加:
   - 月額: ¥1,480 / recurring / monthly → `price_...`（月額）
   - 年額: ¥14,800 / recurring / yearly → `price_...`（年額）
3. **Webhook を追加**: 開発者 → Webhook → エンドポイント追加
   - URL: `https://shift-craft.nexeed-lab.com/api/stripe/webhook`
   - 送信イベント: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - 署名シークレット `whsec_...` を控える
4. **API キー**（シークレットキー `sk_live_...` / テストは `sk_test_...`）を控える。
5. （任意）**顧客ポータル**を有効化（設定 → Billing → Customer portal）。解約・支払い方法変更に使います。
6. （インボイス制度）必要なら「税率・登録番号」を設定し、適格請求書の発行を有効化。

## 2. Cloudflare 側の設定（Secret）
Worker のシークレットとして登録します（値はコードに残りません）。

```sh
npx wrangler secret put STRIPE_SECRET_KEY        # sk_live_... または sk_test_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET     # whsec_...
npx wrangler secret put STRIPE_PRICE_MONTHLY      # price_...（月額）
npx wrangler secret put STRIPE_PRICE_YEARLY       # price_...（年額）
```

戻り先URLを固定したい場合のみ、`wrangler.jsonc` の `vars` に追加（任意）:

```jsonc
"vars": { "APP_URL": "https://shift-craft.nexeed-lab.com" }
```
（未設定の場合はリクエストのオリジンを使います。）

## 3. 動作確認
1. 設定後にデプロイ（PR マージ）。
2. 新規ユーザーで登録（メールアドレス＋パスワード）→ 届いた確認メールのリンクを開いて有効化 → ログインすると 14日トライアル。
3. 「プランを見る」→ 月額/年額を選ぶと Stripe の決済ページへ。テストは `sk_test_` と[テストカード](https://stripe.com/docs/testing) `4242 4242 4242 4242` で確認。
4. 決済完了で Webhook が届き、`subscription_status=active` になりフル機能解放。
5. トライアルを過ぎた未加入ユーザーは AI・書き出しがロックされ「プランを見る」導線が出ます。

## 4. 法令面（日本でのオンライン販売）
- **特定商取引法に基づく表記**ページ（事業者名・料金・解約条件など）を用意して掲載。
- **消費税10%**の内税/外税の方針を Stripe の税設定で反映。
- **インボイス制度（適格請求書）**対応が必要なら登録番号を設定。

## 補足（実装メモ）
- アクセス権限は `worker/index.ts` の `computeEntitlement()` で判定（active/trialing=フル、free=ロック）。
- AI利用上限は層別（trialing=累計5回 / active=毎月30回 / free=0）。
- Webhook 署名は `verifyStripeSignature()` で検証（HMAC-SHA256）。
- フロントの権限は `GET /api/auth/status` の `tier`/`entitled`/`billingConfigured` を `useEntitlement()` で参照。
