// 新着記事をX（旧Twitter）に告知ポストする。
// 使い方: node scripts/post-to-x.mjs <morning|evening> [--dry-run] [--date YYYY-MM-DD]
//   - 当日(JST)の content/posts/YYYY-MM-DD-<mode>.md を読み、見出し＋主要数値＋URLをポスト
//   - edition: notice（お知らせ記事）は告知しない
//   - --dry-run はポスト本文を表示するだけで送信しない
//   - --date はローカルテスト用に対象日を上書きする
// 認証: OAuth 1.0a（環境変数 X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET）
import crypto from "node:crypto";
import { buildPost, composeX, jstToday } from "./lib/social-post.mjs";

const mode = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const dateArg = (() => {
  const i = process.argv.indexOf("--date");
  return i >= 0 ? process.argv[i + 1] : jstToday();
})();
if (!["morning", "evening"].includes(mode)) {
  console.error(
    "使い方: node scripts/post-to-x.mjs <morning|evening> [--dry-run] [--date YYYY-MM-DD]",
  );
  process.exit(1);
}

const post = buildPost(mode, { platform: "x", date: dateArg });
if (post.skip) {
  console.log(`告知をスキップ: ${post.skip}`);
  process.exit(0);
}
const text = composeX(post);

if (dryRun) {
  // X の文字数カウントは t.co 短縮でURLを23文字換算する
  const weighted = [...text.replace(post.url, "x".repeat(23))].length;
  console.log("--- dry-run: 以下の内容を送信します ---");
  console.log(text);
  console.log(`--- X換算 ${weighted} 文字（上限280） ---`);
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
