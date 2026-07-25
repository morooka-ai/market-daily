// 新着記事をX（旧Twitter）に告知ポストする。
// 使い方: node scripts/post-to-x.mjs <morning|evening> [--dry-run]
//   - 当日(JST)の content/posts/YYYY-MM-DD-<mode>.md を読み、タイトル＋URLをポストする
//   - edition: notice（お知らせ記事）は告知しない
//   - --dry-run はポスト本文を表示するだけで送信しない
// 認証: OAuth 1.0a（環境変数 X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET）
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SITE_URL = "https://market-daily.jimulabo.com";

const mode = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!["morning", "evening"].includes(mode)) {
  console.error("使い方: node scripts/post-to-x.mjs <morning|evening> [--dry-run]");
  process.exit(1);
}

// JSTの今日の日付（generate.mjs と同じ方式）
const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
const today = jstNow.toISOString().slice(0, 10);

const slug = `${today}-${mode}`;
const file = path.resolve("content/posts", `${slug}.md`);
if (!fs.existsSync(file)) {
  console.log(`記事がないため告知をスキップ: ${file}`);
  process.exit(0);
}

const src = fs.readFileSync(file, "utf8");
const title = src.match(/^title:\s*"(.+)"\s*$/m)?.[1];
const edition = src.match(/^edition:\s*(\w+)\s*$/m)?.[1];
if (!title) {
  console.error("frontmatter から title を取得できませんでした");
  process.exit(1);
}
if (edition === "notice") {
  console.log("お知らせ記事のため告知をスキップ");
  process.exit(0);
}

const hashtags =
  mode === "morning" ? "#ドル円 #米国株 #為替" : "#日経平均 #東京市場 #株式";
const url = `${SITE_URL}/posts/${slug}/`;
// Xの文字数制限（280。URLは短縮で23文字換算）に収まるようタイトルを保険で切り詰める
const shortTitle = title.length > 120 ? `${title.slice(0, 119)}…` : title;
const text = `${shortTitle}\n\n${url}\n\n${hashtags}`;

if (dryRun) {
  console.log("--- dry-run: 以下の内容を送信します ---");
  console.log(text);
  process.exit(0);
}

const keys = {
  apiKey: process.env.X_API_KEY,
  apiSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
};
if (Object.values(keys).some((v) => !v)) {
  console.error(
    "環境変数 X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET を設定してください",
  );
  process.exit(1);
}

// OAuth 1.0a HMAC-SHA1 署名（RFC 5849。JSONボディは署名対象に含めない）
const pct = (s) =>
  encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );

function oauthHeader(method, requestUrl) {
  const p = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };
  const paramStr = Object.keys(p)
    .sort()
    .map((k) => `${pct(k)}=${pct(p[k])}`)
    .join("&");
  const baseStr = [method, pct(requestUrl), pct(paramStr)].join("&");
  const signingKey = `${pct(keys.apiSecret)}&${pct(keys.accessSecret)}`;
  p.oauth_signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseStr)
    .digest("base64");
  return (
    "OAuth " +
    Object.keys(p)
      .sort()
      .map((k) => `${pct(k)}="${pct(p[k])}"`)
      .join(", ")
  );
}

const endpoint = "https://api.twitter.com/2/tweets";
const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: oauthHeader("POST", endpoint),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ text }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Xへのポストに失敗: HTTP ${res.status}`, JSON.stringify(body));
  process.exit(1);
}
console.log(`ポスト完了: https://x.com/i/status/${body.data?.id ?? ""}`);
