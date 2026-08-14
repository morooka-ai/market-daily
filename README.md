# マーケットデイリー — AI自動投稿の市況ブログ

AI（Gemini）が毎営業日、朝夕2回の市況記事を自動生成して公開する静的ブログです。

| 投稿 | 時刻（日本時間・通年固定） | 内容 |
| --- | --- | --- |
| 朝刊 | 7:30（火〜土） | 米国株 出来高TOP5、USD/JPY（NYクローズ）、金先物、本日の注目ニュース |
| 夕刊 | 16:00（月〜金、祝日除く） | 日経平均の値動き、ドル円・金の動き、今晩〜明日の注目ニュース |

## 仕組み

```
GitHub Actions（スケジュール実行）
  → 市場データ取得（Yahoo Finance / Alpha Vantage）
  → Gemini API が記事を執筆（Google検索で注目ニュースを確認）
  → Markdownをリポジトリにコミット
  → Astroでビルドして Google Cloud Run に自動公開
```

- 「注目ニュース」の各項目は `### 1. 【重要度：高】イベント名（日時）` の形式で書かせ、
  ビルド時に `src/news-importance.mjs` が重要度バッジ付きのカードに組み替えます。
- 土日・日本の祝日・米国市場の休場日は自動でスキップします。
- 全記事に免責事項が自動表示されます。プロンプトで個別銘柄の売買推奨を禁止しています。

## セットアップ手順

### 0. 事前に必要なもの

- **Git**（未インストールの場合: https://git-scm.com/download/win ）
- **GitHubアカウント**
- **Googleアカウント**（Google Cloud 用）
- **Gemini APIキー**（無料・クレジットカード不要）: https://aistudio.google.com/apikey で取得
- **Alpha Vantage APIキー**（無料）: https://www.alphavantage.co/support/#api-key

### 1. GitHubリポジトリを作成してプッシュ

```sh
git init
git add .
git commit -m "初期コミット"
# GitHubで新規リポジトリ（例: market-daily）を作成してから:
git remote add origin https://github.com/<ユーザー名>/market-daily.git
git branch -M main
git push -u origin main
```

### 2. シークレットを登録

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で:

| 名前 | 値 |
| --- | --- |
| `GEMINI_API_KEY` | Gemini のAPIキー |
| `ALPHAVANTAGE_API_KEY` | Alpha Vantage のAPIキー |

### 3. Google Cloud（Cloud Run）を設定

1. https://console.cloud.google.com でGCPプロジェクトを作成
2. Cloud Run API を有効化し、サービスアカウント `github-action-deploy` を作成
3. 認証とArtifact Registryのセットアップ:

```sh
npm install -g firebase-tools
firebase login   # GCPプロジェクトにオーナー権限のあるGoogleアカウントで
node scripts/setup/cloud-run-deploy-auth.mjs      # 鍵レス認証（WIF）を自動設定
node scripts/setup/cloud-run-domain-mapping.mjs   # カスタムドメイン設定（任意）
```

- 認証は Workload Identity Federation（鍵レス）なので、**GitHub Secrets への鍵登録は不要**です
- プロジェクトIDを変える場合は `scripts/setup/cloud-run-deploy-auth.mjs` 冒頭の定数と `.github/workflows/deploy.yml` 内の `env` も合わせて変更してください
- カスタムドメインを使う場合は、事前に Google Search Console でドメイン所有権を確認し、DNS に CNAME（`ghs.googlehosted.com.`）を追加してください

### 4. 動作確認

**Actions** タブから各ワークフローを手動実行（Run workflow）できます。

1. 「サイトをビルドしてCloud Runへ公開」を実行 → https://market-daily.jimulabo.com でサイト表示を確認
2. 「夕刊を生成」または「朝刊を生成」を実行 → 記事が生成・公開されるか確認

以降は毎営業日、自動で投稿されます。

## 会員機能（無料会員登録・表示銘柄の選択・メール配信）

| 機能 | 内容 |
| --- | --- |
| 無料会員登録 | **メールアドレス（＝ログインID）とパスワード**で登録 |
| 表示銘柄の選択 | FX・貴金属・暗号資産・日本株・米国株の各ページで**0〜12件**を選択（0件＝全銘柄を表示。並び順は各ページの既定順のまま） |
| メール配信 | **希望した会員のみ**。選択銘柄の価格と当日の記事を毎営業日16:30ごろ配信 |
| パスワード再設定 | Firebase が送る再設定メールで対応（**送信サービスの契約前でも動きます**） |

「任意」なのは**配信を受け取るかどうか**です。会員登録の時点では配信されず、
登録画面のチェック（既定オフ）またはマイページから申し込み、確認メールのリンクを
開いた会員にだけ配信します。

サイトは静的サイトのまま（nginx / Cloud Run 構成は変更なし）で、認証とデータ保存は
ブラウザから Firebase を直接呼びます。**設定を入れるまでは会員機能が「準備中」表示になるだけ**で、
サイトのビルド・公開はこれまでどおり動きます。

```
[ブラウザ] ──Firebase SDK──> Firebase Authentication（ID+パスワード）
                          ├─> Firestore  users/{uid}     … 選択銘柄・配信先メール
                          └─> Firestore  mailConfirms/…  … 配信開始の申請（作成のみ）

[GitHub Actions] ──WIF──> Firestore（Admin SDK）──> 送信サービス ──> 会員
                            └ 申請のトークンを照合してから配信を開始する
```

- 登録直後に Firebase がメールアドレスの確認メールを送ります（宛先の打ち間違いをその場で
  気づけるようにするため）。未確認でも機能は使えますが、マイページに確認をうながす表示が出ます。
- **配信の開始だけはブラウザから直接反映しません。** 確認ページのボタンは `mailConfirms` に
  申請を1件作るだけで、毎時のバッチが Admin SDK でトークンを照合してから配信中に切り替えます
  （反映まで最大1時間）。Firestore のセキュリティルールでは「トークンを知っていること」を
  検証できない（ルールからは書き込み後の姿しか見えず、送っていないフィールドも保存済みの値として
  現れる）ため、同意の確認をサーバー側に置いています。配信の**停止**は影響が「配信が止まる」だけなので、
  ブラウザから即時に反映します。
- 各ページのHTMLには常に全銘柄を出力し、会員の選択は CSS で絞り込みます。
  検索エンジンには全件が見え、非表示の銘柄はチャートウィジェットも読み込まれません。
- Firebase SDK は**必要になったときだけ動的読み込み**します。未ログインの訪問者には
  約2KBのスクリプトしか配信されないため、表示速度は変わりません。

### 5. Firebase を設定する（会員機能を有効にする）

1. https://console.firebase.google.com で「プロジェクトを追加」→ **既存のGCPプロジェクト
   `market-daily-503003` を選択**（新規に作らないこと。Cloud Run と同じプロジェクトに揃える）
2. **Authentication** → 始める → ログイン方法で「**メール / パスワード**」を有効化
3. Authentication → 設定 → **承認済みドメイン**に `market-daily.jimulabo.com` を追加（これが無いとログインできません）
   - Authentication → **Templates（テンプレート）** で「パスワードの再設定」「メールアドレスの確認」の
     言語を日本語にし、差出人名をサイト名に変更しておくと体裁が整います
   - これらのメールは Firebase が無料で送るため、下記6のメール送信サービスとは無関係に動きます
4. **Firestore Database** を作成（本番環境モード、ロケーション `asia-northeast1`）
5. セキュリティルールを反映する（**必須**。これが実質的なアクセス制御です）

   ```sh
   firebase login          # 認証が切れている場合は firebase login --reauth
   firebase deploy --only firestore:rules
   ```

   （`firebase.json` と `.firebaserc` を用意してあるので、プロジェクト指定は不要です）

   もしくは Firebase コンソールの Firestore → ルール に `firestore.rules` の内容を貼り付けて公開。

   公開前に Firestore → ルール → **Rules Playground** で次の3点を確認しておくと安全です。

   | シミュレーション | 期待する結果 |
   | --- | --- |
   | 未認証で `users/<他人のUID>` を `get` | **拒否** |
   | 認証済み（自分のUID）で `users/<自分のUID>` を `get` / `update` | 許可 |
   | 未認証で `users/<UID>` を `update`（`mail.token` に誤った値を入れる） | **拒否** |
   | 未認証で `users/<UID>` を `update`（`mail.status` を `subscribed` にする） | **拒否** |
   | 未認証で `mailConfirms/<任意ID>` を `get` / `list` | **拒否** |
6. プロジェクトの設定 → マイアプリ → **ウェブアプリを追加**し、表示される構成値を控える
7. GitHubの **Settings → Secrets and variables → Actions → Variables** に登録
   （ブラウザに埋め込まれる公開値なので Secrets ではなく Variables でよい）

   | 名前 | 値の例 |
   | --- | --- |
   | `PUBLIC_FIREBASE_API_KEY` | `AIza...` |
   | `PUBLIC_FIREBASE_AUTH_DOMAIN` | `market-daily-503003.firebaseapp.com` |
   | `PUBLIC_FIREBASE_PROJECT_ID` | `market-daily-503003` |
   | `PUBLIC_FIREBASE_APP_ID` | `1:...:web:...` |

8. 「サイトをビルドしてCloud Runへ公開」を実行 → `/account/register/` で登録できるか確認

### 6. メール配信を設定する（任意・後からでOK）

送信サービスは `MAIL_PROVIDER` で差し替えられます（`resend` / `brevo` / `sendgrid`）。
追加するときは `scripts/lib/mailer.mjs` の `PROVIDERS` に1関数を足すだけです。

1. 送信サービスでアカウントを作り、APIキーを取得。独自ドメインから送るなら
   案内される **SPF / DKIM のDNSレコードを `jimulabo.com` に追加**する
2. サービスアカウントに Firestore の読み書き権限を付与する

   ```sh
   gcloud projects add-iam-policy-binding market-daily-503003 \
     --member="serviceAccount:github-action-deploy@market-daily-503003.iam.gserviceaccount.com" \
     --role="roles/datastore.user"
   ```

3. GitHubの **Variables** に登録

   | 名前 | 値の例 |
   | --- | --- |
   | `MAIL_ENABLED` | `true`（`true` 以外だと配信ワークフローは動きません） |
   | `MAIL_PROVIDER` | `resend` |
   | `MAIL_FROM` | `daily@market-daily.jimulabo.com` |
   | `MAIL_FROM_NAME` | `マーケットデイリー`（省略可） |

4. GitHubの **Secrets** に `MAIL_API_KEY` を登録
5. 送信前に本文を確認する（送信せず内容を表示するだけ）

   ```sh
   MAIL_PROVIDER=console MAIL_FROM=daily@example.com npm run mail:sample
   ```

配信ワークフロー（`.github/workflows/mail.yml`）は次の2本立てです。

- **毎時**: 配信開始の申請の反映（トークンを照合して配信中に切り替え）と、
  配信登録の確認メールの送信（登録直後の会員に届く。最大1時間ほどの遅延があります）
- **平日16:30 JST**: 上記に加えて当日のダイジェスト配信

このワークフローが動いていないと**配信の開始が反映されません**（確認ページのボタンを押しても
「申し込み受付」のまま止まります）。メール配信を有効にする場合は `MAIL_ENABLED=true` を
忘れずに設定してください。

### 法令対応として組み込んである点

- **ダブルオプトイン**: 会員登録しただけでは配信されず、配信を申し込んだうえで確認メール内の
  リンクを開いてボタンを押した会員にのみ配信します（特定電子メール法のオプトイン規制）。
  登録画面の「配信を受け取る」チェックは既定でオフです。
  確認メールに含まれるトークンの照合はサーバー側（Admin SDK のバッチ）で行うため、
  ブラウザからの操作だけで配信が始まることはありません
- パスワード再設定・アドレス確認のメールは、本サービスの提供に必要な連絡（取引関係メール）として
  配信の申し込みとは切り離して送ります
- **配信停止**: 全配信メールの本文末尾と `List-Unsubscribe` ヘッダーに停止リンクを付けています。
  ログイン不要で停止でき、マイページからも解除・退会できます
- **送信者の表示**: 全メールに発行者名・サイトURL・問い合わせ先を記載しています
- **確認/停止リンクは要クリック**: メールのセキュリティスキャナがリンクを自動で開いても
  誤って配信開始・停止されないよう、ページ上でボタンを押す方式にしています
- 取得する情報と利用目的は `src/pages/privacy.astro`、利用条件は `src/pages/terms.astro` に記載

## コスト目安

- **すべて無料枠内で運用できます（月0円）**
- Gemini API（gemini-3.5-flash）: 無料枠は1日2記事なら十分。Google検索グラウンディングも月5,000回まで無料
  - 注意: 無料枠ではプロンプト等がGoogleのモデル改善に利用されることがあります（市況データのみのため実害なし）
  - モデルを変える場合: **Settings → Secrets and variables → Actions → Variables** で `ARTICLE_MODEL` を設定（Proモデルは無料枠対象外なので注意）
- GitHub Actions / Yahoo Finance / Alpha Vantage: 無料枠内
- Cloud Run: 無料枠（月200万リクエスト・メモリ 360,000 GiB秒）内に収まる想定。最小インスタンス0（アクセスがない時間は課金なし）
- Artifact Registry: 無料枠は0.5GBまで。デプロイのたびにイメージが1つ増えるので、
  クリーンアップポリシー（最新10世代は保持・30日より古いものは削除）を一度設定しておきます。

  ```sh
  firebase login   # 認証が切れている場合は firebase login --reauth
  node scripts/setup/artifact-registry-cleanup.mjs --status   # 現在の設定とサイズを確認
  node scripts/setup/artifact-registry-cleanup.mjs --dry-run  # 判定だけ（削除しない）
  node scripts/setup/artifact-registry-cleanup.mjs            # 有効化
  ```
- Firebase Authentication / Firestore: 無料枠（Firestore は1日あたり読み取り5万・書き込み2万）内。
  会員1人あたりの読み書きはごくわずかなので、数千人規模まで無料枠で足ります
- メール送信サービス: 無料枠は各社1日100〜300通程度。会員数がこれを超える場合は有料プランの検討が必要です

## カスタマイズ

- **サイト名・説明**: `src/consts.mjs`
- **掲載銘柄の追加・変更**: `src/chart-pairs.mjs`（FX・貴金属・暗号資産）、`src/us-stocks-data.mjs`、
  `src/jp-stocks-data.mjs`。会員の選択肢とメール配信の対象は `src/catalog.mjs` が
  これらを束ねて自動生成するので、追加時に触るのは各定義ファイルだけです
  （メール配信で価格を出すため `yahooSymbol` は必ず設定してください）
- **1ページあたりの選択上限（12件）**: `src/catalog.mjs` の `MAX_SELECTION`
  （変更する場合は `firestore.rules` の `selectionOk` にある `12` も合わせてください）
- **詳細ページを検索結果に載せない銘柄**: `src/chart-pairs.mjs` の `NOINDEX_DETAIL_IDS`。
  ここに入れた銘柄は一覧ページには出ますが、`/charts/<id>/` が noindex になり
  サイトマップからも外れます（中身の薄いページを検索対象に増やさないため）
- **記事の書き方・禁止事項**: `scripts/lib/article.mjs` の `SYSTEM` プロンプト
- **投稿時刻**: `.github/workflows/post-*.yml` の `cron`（UTC表記。JST−9時間）
- **免責事項の文言**: `src/components/Disclaimer.astro` と `src/pages/disclaimer.astro`
- サンプル記事 `content/posts/2026-07-14-sample.md` は運用開始後に削除してください

## ローカルでの開発について

⚠️ このフォルダが **Googleドライブ上（G:）にある場合、`npm install` が失敗します**（Google Drive for Desktop の制限）。ローカルで開発・プレビューする場合は、プロジェクトを `C:` ドライブ上のフォルダにコピー（または`git clone`）してください。本番の記事生成・公開はすべてGitHub Actions上で動くため、運用には影響ありません。

```sh
npm install
npm run dev          # プレビュー (http://localhost:4321)
npm run generate:evening  # 記事生成を手動実行（要 GEMINI_API_KEY 環境変数）
```

## 法令面の注意

- 記事は一般的な市況解説にとどめ、個別銘柄の売買推奨（投資助言）を行わない設計です。プロンプトを変更する際もこの方針を維持してください。
- アフィリエイト広告を掲載する場合は、景品表示法（ステマ規制）に基づき「広告」「PR」の表記が必要です。
- 自動生成された記事は公開後でも構いませんので定期的に目視確認することを推奨します。
