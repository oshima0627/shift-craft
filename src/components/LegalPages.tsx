/**
 * 法令ページ（公開・ログイン不要）。
 * - 特定商取引法に基づく表記   … /legal
 * - 利用規約                   … /terms
 * - プライバシーポリシー       … /privacy
 *
 * ルーティングは AuthShell から `window.location.pathname` を見て振り分ける
 * （`/register` と同じ方式）。SPA フォールバック（wrangler の
 * `not_found_handling: single-page-application`）により、どのパスでも
 * index.html が返るのでリロード・直リンクでも表示できる。
 */

// ───────────────────────────────────────────────────────────
// 事業者情報（★ここを実際の情報に書き換えてください）
// 住所・電話番号は「請求があれば遅滞なく開示」方式にしています。
// 常時掲載したい場合は下の address / phone を実際の値にして、
// 特商法ページの該当箇所（開示方式の分岐）を差し替えてください。
// ───────────────────────────────────────────────────────────
const OPERATOR = {
  /** サービス名 */
  service: 'ShiftCraft',
  /** 販売事業者名（屋号・法人名） */
  seller: 'Nexeed Lab',
  /** 運営統括責任者 */
  manager: '大島 直孝',
  /** 連絡先メールアドレス */
  email: 'oshima6.27@gmail.com',
  /** 住所（空なら「請求に応じて開示」と表示） */
  address: '',
  /** 電話番号（空なら「請求に応じて開示」と表示） */
  phone: '',
  /** 受付時間・連絡方法の補足 */
  contactNote: 'お問い合わせはメールにて承ります。原則3営業日以内に返信します。',
  /** 料金 */
  priceMonthly: '1,480円（税込）／月',
  priceYearly: '14,800円（税込）／年',
  /** 最終改定日 */
  updatedAt: '2026年7月21日',
}

/** 法令ページ共通レイアウト（ヘッダー＋戻るリンク＋本文カード） */
function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <a href="/" className="text-xl font-bold tracking-tight text-slate-900 hover:opacity-80">
            {OPERATOR.service}
          </a>
          <a href="/" className="text-sm font-semibold text-brand-600 hover:underline">
            ← アプリへ戻る
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">最終改定日：{OPERATOR.updatedAt}</p>
          <div className="mt-6 space-y-6 text-[15px] leading-relaxed text-slate-700">
            {children}
          </div>
        </div>

        <LegalFooter />
      </main>
    </div>
  )
}

/** 各法令ページへの相互リンク（フッター） */
function LegalFooter() {
  return (
    <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-500">
      <a href="/legal" className="hover:text-brand-600 hover:underline">
        特定商取引法に基づく表記
      </a>
      <span className="text-slate-300">|</span>
      <a href="/terms" className="hover:text-brand-600 hover:underline">
        利用規約
      </a>
      <span className="text-slate-300">|</span>
      <a href="/privacy" className="hover:text-brand-600 hover:underline">
        プライバシーポリシー
      </a>
    </nav>
  )
}

/** 見出し＋本文のセクション */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold text-slate-800">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

/** 定義リスト（項目名 → 内容）。特商法の表に使う */
function DefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
      <dt className="font-semibold text-slate-800">{label}</dt>
      <dd className="text-slate-700">{children}</dd>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// 特定商取引法に基づく表記
// ───────────────────────────────────────────────────────────
export function TokushohoPage() {
  return (
    <LegalLayout title="特定商取引法に基づく表記">
      <dl className="divide-y divide-slate-100">
        <DefRow label="販売事業者">{OPERATOR.seller}</DefRow>
        <DefRow label="運営統括責任者">{OPERATOR.manager}</DefRow>
        <DefRow label="所在地">
          {OPERATOR.address ? (
            OPERATOR.address
          ) : (
            <>ご請求をいただいた場合、遅滞なく電子メールにて開示します。</>
          )}
        </DefRow>
        <DefRow label="電話番号">
          {OPERATOR.phone ? (
            OPERATOR.phone
          ) : (
            <>ご請求をいただいた場合、遅滞なく電子メールにて開示します。</>
          )}
        </DefRow>
        <DefRow label="メールアドレス">
          <a href={`mailto:${OPERATOR.email}`} className="text-brand-600 hover:underline">
            {OPERATOR.email}
          </a>
          <p className="mt-1 text-sm text-slate-500">{OPERATOR.contactNote}</p>
        </DefRow>
        <DefRow label="販売価格">
          <ul className="list-disc space-y-1 pl-5">
            <li>月額プラン：{OPERATOR.priceMonthly}</li>
            <li>年額プラン：{OPERATOR.priceYearly}</li>
          </ul>
          <p className="mt-1 text-sm text-slate-500">
            価格は各申込画面に表示します。表示価格はすべて消費税込みです。
          </p>
        </DefRow>
        <DefRow label="商品代金以外の必要料金">
          インターネット接続に必要な通信料金等は、お客様のご負担となります。
        </DefRow>
        <DefRow label="お支払い方法">
          クレジットカード（決済代行：Stripe, Inc.）。お支払いはStripeの決済ページで行われます。
        </DefRow>
        <DefRow label="お支払い時期">
          お申し込み時（無料トライアル付きの場合はトライアル終了日）に初回課金を行い、以後は
          月額プランは毎月、年額プランは毎年、同日に自動更新・課金されます。
        </DefRow>
        <DefRow label="サービスの提供時期">
          決済完了後、直ちにご利用いただけます（無料トライアルは登録完了後すぐに開始します）。
        </DefRow>
        <DefRow label="無料トライアル">
          新規登録から14日間は無料でフル機能をお試しいただけます。トライアル期間中に解約された
          場合、料金は発生しません。
        </DefRow>
        <DefRow label="解約・返品について">
          <p>
            本サービスはデジタルコンテンツ（オンラインサービス）の性質上、決済後の返金・返品は
            原則としてお受けできません。
          </p>
          <p className="mt-2">
            月額・年額プランはいつでも解約できます。解約はアプリ内の「プランを見る」→「支払い方法の
            変更・解約はこちら」から、Stripeの顧客ポータルにてお手続きいただけます。解約後は、
            当該請求期間の末日までご利用いただけ、次回以降の更新・課金は行われません（日割りの
            返金はありません）。
          </p>
        </DefRow>
        <DefRow label="動作環境">
          最新版のGoogle Chrome、Microsoft Edge、Safari 等のモダンブラウザ。
        </DefRow>
      </dl>
    </LegalLayout>
  )
}

// ───────────────────────────────────────────────────────────
// 利用規約
// ───────────────────────────────────────────────────────────
export function TermsPage() {
  return (
    <LegalLayout title="利用規約">
      <p>
        本利用規約（以下「本規約」といいます）は、{OPERATOR.seller}（以下「当方」といいます）が
        提供するシフト表作成サービス「{OPERATOR.service}」（以下「本サービス」といいます）の
        利用条件を定めるものです。利用者（以下「ユーザー」といいます）は、本規約に同意のうえ
        本サービスを利用するものとします。
      </p>

      <Section title="第1条（適用）">
        <p>
          本規約は、本サービスの提供条件およびユーザーと当方との間の権利義務関係に適用されます。
          当方が本サービス上に掲載する個別の注意事項・ガイドライン等は、本規約の一部を構成します。
        </p>
      </Section>

      <Section title="第2条（利用登録）">
        <p>
          本サービスの利用を希望する者は、本規約に同意し、当方の定める方法により利用登録を
          申請するものとします。当方は、申請者に一定の事由があると判断した場合、登録を承認しない
          ことがあります。登録情報に虚偽があった場合も同様です。
        </p>
      </Section>

      <Section title="第3条（アカウントの管理）">
        <p>
          ユーザーは、自己の責任においてID・パスワードを適切に管理するものとします。ID・パスワードの
          管理不十分、使用上の過誤、第三者の使用等による損害の責任はユーザーが負うものとし、当方は
          一切の責任を負いません。
        </p>
      </Section>

      <Section title="第4条（料金および支払方法）">
        <p>
          ユーザーは、有料プランの利用にあたり、当方が別途定め本サービスに表示する料金を、当方が
          指定する決済代行事業者（Stripe）を通じて支払うものとします。無料トライアル期間の経過後は、
          選択したプランに応じて自動的に課金・更新されます。
        </p>
      </Section>

      <Section title="第5条（解約）">
        <p>
          ユーザーは、本サービス内の手続き（Stripe顧客ポータル）により、いつでも有料プランを
          解約できます。解約した場合でも、当該請求期間の末日までは有料機能を利用でき、次回以降の
          更新・課金は停止されます。既にお支払い済みの料金の日割り返金は行いません。
        </p>
      </Section>

      <Section title="第6条（禁止事項）">
        <p>ユーザーは、本サービスの利用にあたり、次の行為をしてはなりません。</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>法令または公序良俗に違反する行為</li>
          <li>犯罪行為に関連する行為</li>
          <li>当方または第三者の知的財産権・プライバシー・名誉その他の権利を侵害する行為</li>
          <li>本サービスのサーバーやネットワークに過度の負荷をかける行為、不正アクセス</li>
          <li>本サービスを複製・改変・リバースエンジニアリングする行為</li>
          <li>当方の許諾なく本サービスを再販売・再配布する行為</li>
          <li>その他、当方が不適切と合理的に判断する行為</li>
        </ul>
      </Section>

      <Section title="第7条（本サービスの提供の停止等）">
        <p>
          当方は、システムの保守点検、地震・停電等の不可抗力、通信回線の障害その他やむを得ない
          事由がある場合、ユーザーへの事前の通知なく本サービスの全部または一部の提供を停止・中断
          できるものとします。これによりユーザーに生じた損害について、当方は責任を負いません。
        </p>
      </Section>

      <Section title="第8条（データの取扱い）">
        <p>
          本サービスにおいてユーザーが入力・作成したデータ（役割・スタッフ・シフト表等）は、
          本サービスの提供のために当方のインフラ上に保存されます。ユーザーは、重要なデータについて
          自らバックアップ（CSV出力等）を行うものとし、当方はデータの消失・破損について、当方の
          故意または重過失による場合を除き責任を負いません。
        </p>
      </Section>

      <Section title="第9条（免責事項）">
        <p>
          本サービスは現状有姿で提供され、当方は、本サービスに事実上または法律上の瑕疵がないこと、
          特定目的への適合性、期待する結果が得られることを保証しません。本サービスが生成するシフト表
          （AIによる解釈結果を含む）はあくまで補助的な提案であり、最終的な内容の確認・決定は
          ユーザーの責任で行うものとします。
        </p>
        <p>
          当方の債務不履行または不法行為によりユーザーに生じた損害の賠償責任は、当方に故意または
          重過失がある場合を除き、当該ユーザーが直近12か月間に当方へ支払った利用料金の総額を上限と
          します。
        </p>
      </Section>

      <Section title="第10条（規約の変更）">
        <p>
          当方は、必要と判断した場合、ユーザーへの通知（本サービス上での掲示を含む）により、本規約を
          変更できるものとします。変更後に本サービスを利用した場合、変更後の規約に同意したものと
          みなします。
        </p>
      </Section>

      <Section title="第11条（準拠法・管轄）">
        <p>
          本規約の解釈にあたっては日本法を準拠法とします。本サービスに関して紛争が生じた場合には、
          当方の所在地を管轄する裁判所を専属的合意管轄とします。
        </p>
      </Section>

      <p className="text-sm text-slate-500">
        お問い合わせ：
        <a href={`mailto:${OPERATOR.email}`} className="text-brand-600 hover:underline">
          {OPERATOR.email}
        </a>
      </p>
    </LegalLayout>
  )
}

// ───────────────────────────────────────────────────────────
// プライバシーポリシー
// ───────────────────────────────────────────────────────────
export function PrivacyPage() {
  return (
    <LegalLayout title="プライバシーポリシー">
      <p>
        {OPERATOR.seller}（以下「当方」といいます）は、シフト表作成サービス「{OPERATOR.service}」
        （以下「本サービス」といいます）における個人情報の取扱いについて、以下のとおり
        プライバシーポリシー（以下「本ポリシー」といいます）を定めます。
      </p>

      <Section title="1. 取得する情報">
        <ul className="list-disc space-y-1 pl-5">
          <li>アカウント情報：メールアドレス（ログインID）、パスワード（ハッシュ化して保存）</li>
          <li>
            サービス利用データ：ユーザーが入力・作成した役割、時間帯、スタッフ名、シフト表、条件等
          </li>
          <li>
            決済関連情報：契約プラン・課金状態・Stripeの顧客ID等（クレジットカード番号そのものは
            当方では保持せず、決済代行事業者Stripeが管理します）
          </li>
          <li>技術情報：アクセスログ、Cookie等、サービスの提供・改善に必要な情報</li>
        </ul>
      </Section>

      <Section title="2. 利用目的">
        <ul className="list-disc space-y-1 pl-5">
          <li>本サービスの提供・維持・保護・改善のため</li>
          <li>ユーザー認証およびアカウント管理のため</li>
          <li>利用料金の請求・決済のため</li>
          <li>お問い合わせ対応、重要なお知らせの連絡のため</li>
          <li>利用規約に違反する行為への対応のため</li>
        </ul>
      </Section>

      <Section title="3. AI（人工知能）機能について">
        <p>
          本サービスの一部機能では、ユーザーが入力した条件文等のテキストを、AIによる解釈のために
          外部のAIサービス（Anthropic社のAPI）へ送信します。送信されるのは解釈に必要な範囲の
          テキストに限られます。当該送信先におけるデータの取扱いは、各提供事業者のポリシーに従います。
        </p>
      </Section>

      <Section title="4. 第三者提供">
        <p>
          当方は、次の場合を除き、あらかじめユーザーの同意を得ることなく個人情報を第三者に提供しません。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>法令に基づく場合</li>
          <li>人の生命・身体・財産の保護のために必要で、本人の同意を得ることが困難な場合</li>
          <li>
            サービス提供に必要な範囲で業務委託先（決済代行、クラウドインフラ、AIサービス等）に
            取り扱わせる場合
          </li>
        </ul>
      </Section>

      <Section title="5. 業務委託先・利用する外部サービス">
        <ul className="list-disc space-y-1 pl-5">
          <li>Cloudflare, Inc.（アプリケーションの配信・データベース基盤）</li>
          <li>Stripe, Inc.（クレジットカード決済の処理）</li>
          <li>Anthropic PBC（AIによる条件解釈機能）</li>
          <li>Resend（メール送信）</li>
        </ul>
      </Section>

      <Section title="6. 安全管理措置">
        <p>
          当方は、個人情報の漏えい・滅失・毀損の防止その他の安全管理のために必要かつ適切な措置を
          講じます。通信は暗号化（HTTPS）され、パスワードはハッシュ化して保存します。
        </p>
      </Section>

      <Section title="7. Cookie等の利用">
        <p>
          本サービスは、ログイン状態の維持等のためにCookieまたは同等の技術を使用します。ブラウザの
          設定によりCookieを無効化できますが、その場合、本サービスの一部機能が利用できないことが
          あります。
        </p>
      </Section>

      <Section title="8. 開示・訂正・削除等の請求">
        <p>
          ユーザーは、当方が保有する自己の個人情報について、開示・訂正・利用停止・削除等を請求
          できます。ご希望の場合は、下記お問い合わせ先までご連絡ください。ご本人であることを確認の
          うえ、法令に従い対応します。
        </p>
      </Section>

      <Section title="9. 本ポリシーの変更">
        <p>
          当方は、必要に応じて本ポリシーを変更することがあります。変更後の内容は、本サービス上に
          掲示した時点から効力を生じるものとします。
        </p>
      </Section>

      <Section title="10. お問い合わせ窓口">
        <p>
          運営事業者：{OPERATOR.seller}
          <br />
          個人情報保護管理責任者：{OPERATOR.manager}
          <br />
          連絡先：
          <a href={`mailto:${OPERATOR.email}`} className="text-brand-600 hover:underline">
            {OPERATOR.email}
          </a>
        </p>
      </Section>
    </LegalLayout>
  )
}
