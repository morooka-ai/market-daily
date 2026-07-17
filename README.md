# マーケットデイリー — AI自動投稿の市況ブログ

AI（Claude）が毎営業日、朝夕2回の市況記事を自動生成して公開する静的ブログです。

| 投稿 | 時刻（日本時間・通年固定） | 内容 |
| --- | --- | --- |
| 朝刊 | 7:30（火〜土） | 米国株 出来高TOP5、USD/JPY（NYクローズ）、金先物、本日の注目ニュース |
| 夕刊 | 16:00（月〜金、祝日除く） | 日経平均の値動き、ドル円・金の動き、今晩〜明日の注目ニュース |

## 仕組み

```
GitHub Actions（スケジュール実行）
  → 市場データ取得（Yahoo Finance / Alpha Vantage）
  → Claude API が記事を執筆（web検索で注目ニュースを確認）
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
- **Anthropic APIキー**: https://platform.claude.com/ で取得（クレジット購入が必要）
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
| `ANTHROPIC_API_KEY` | Anthropic のAPIキー |
| `ALPHAVANTAGE_API_KEY` | Alpha Vantage のAPIキー |

### 3. Firebase Hosting を設定

1. https://console.firebase.google.com/ で **プロジェクトを追加**（プロジェクトIDを控える。Google アナリティクスは不要）
2. **プロジェクトの設定（歯車）→ サービス アカウント → 新しい秘密鍵の生成** で JSON キーをダウンロード
3. リポジトリに登録:
   - **Settings → Secrets and variables → Actions → New repository secret** で `FIREBASE_SERVICE_ACCOUNT` = ダウンロードした JSON の中身全体
   - 同じ画面の **Variables** タブで `FIREBASE_PROJECT_ID` = FirebaseのプロジェクトID
4. 登録後、JSON キーファイルはPCから削除しておくと安全です

### 4. 動作確認

**Actions** タブから各ワークフローを手動実行（Run workflow）できます。

1. 「サイトをビルドしてFirebase Hostingへ公開」を実行 → `https://<プロジェクトID>.web.app` でサイト表示を確認
2. 「夕刊を生成」または「朝刊を生成」を実行 → 記事が生成・公開されるか確認

以降は毎営業日、自動で投稿されます。

## コスト目安

- Claude API（Opus 4.8 + web検索）: 1記事あたりおよそ10〜40円。1日2記事 × 月22営業日で **月1,000〜2,000円程度**
- コストを下げたい場合: **Settings → Secrets and variables → Actions → Variables** で `ARTICLE_MODEL` = `claude-sonnet-5` を設定（約1/2〜1/3になります）
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
npm run generate:evening  # 記事生成を手動実行（要 ANTHROPIC_API_KEY 環境変数）
```

## 法令面の注意

- 記事は一般的な市況解説にとどめ、個別銘柄の売買推奨（投資助言）を行わない設計です。プロンプトを変更する際もこの方針を維持してください。
- アフィリエイト広告を掲載する場合は、景品表示法（ステマ規制）に基づき「広告」「PR」の表記が必要です。
- 自動生成された記事は公開後でも構いませんので定期的に目視確認することを推奨します。
