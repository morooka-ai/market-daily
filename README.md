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
  → Astroでビルドして Firebase Hosting（Google Cloud）に自動公開
```

- 土日・日本の祝日・米国市場の休場日は自動でスキップします。
- 全記事に免責事項が自動表示されます。プロンプトで個別銘柄の売買推奨を禁止しています。

## セットアップ手順

### 0. 事前に必要なもの

- **Git**（未インストールの場合: https://git-scm.com/download/win ）
- **GitHubアカウント**
- **Googleアカウント**（Firebase Hosting 用）
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

### 3. Firebase Hosting を設定

```sh
npm install -g firebase-tools
firebase login
firebase projects:create <プロジェクトID> --display-name "Market Daily"  # 表示名は英数字のみ
node scripts/setup/firebase-deploy-auth.mjs  # デプロイ用の鍵レス認証（WIF）を自動設定
```

- 認証は Workload Identity Federation（鍵レス）なので、**GitHub Secrets への鍵登録は不要**です
- プロジェクトIDを変える場合は `scripts/setup/firebase-deploy-auth.mjs` 冒頭の定数と `.github/workflows/deploy.yml` 内のプロジェクトID・プロバイダ設定も合わせて変更してください

### 4. 動作確認

**Actions** タブから各ワークフローを手動実行（Run workflow）できます。

1. 「サイトをビルドしてFirebase Hostingへ公開」を実行 → https://market-daily-jimulabo.web.app でサイト表示を確認
2. 「夕刊を生成」または「朝刊を生成」を実行 → 記事が生成・公開されるか確認

以降は毎営業日、自動で投稿されます。

## コスト目安

- **すべて無料枠内で運用できます（月0円）**
- Gemini API（gemini-3.5-flash）: 無料枠は1日2記事なら十分。Google検索グラウンディングも月5,000回まで無料
  - 注意: 無料枠ではプロンプト等がGoogleのモデル改善に利用されることがあります（市況データのみのため実害なし）
  - モデルを変える場合: **Settings → Secrets and variables → Actions → Variables** で `ARTICLE_MODEL` を設定（Proモデルは無料枠対象外なので注意）
- GitHub Actions / Firebase Hosting / Yahoo Finance / Alpha Vantage: 無料枠内（Firebase Hosting の無料枠はストレージ10GB・転送360MB/日で、テキスト中心のブログなら十分収まります）

## カスタマイズ

- **サイト名・説明**: `src/consts.mjs`
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
