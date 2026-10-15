// 新着記事を Bluesky に告知ポストする。
// 使い方: node scripts/post-to-bluesky.mjs <morning|evening> [--dry-run] [--date YYYY-MM-DD]
//   - 当日(JST)の content/posts/YYYY-MM-DD-<mode>.md を読み、見出し＋主要数値をポスト
//   - リンクは本文に入れず app.bsky.embed.external（OGPカード）で添付する
//   - edition: notice（お知らせ記事）は告知しない
//   - --dry-run は本文を表示するだけで送信しない
//   - --date はローカルテスト用に対象日を上書きする
// 認証: 環境変数 BLUESKY_HANDLE（例 market-daily.bsky.social）/ BLUESKY_APP_PASSWORD（アプリパスワード）
import {
  SITE_URL,
  buildPost,
  composeBluesky,
  jstToday,
} from "./lib/social-post.mjs";

const PDS = "https://bsky.social";

const mode = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const dateArg = (() => {
  const i = process.argv.indexOf("--date");
  return i >= 0 ? process.argv[i + 1] : jstToday();
})();
if (!["morning", "evening"].includes(mode)) {
  console.error(
    "使い方: node scripts/post-to-bluesky.mjs <morning|evening> [--dry-run] [--date YYYY-MM-DD]",
  );
  process.exit(1);
}

const post = buildPost(mode, { platform: "bluesky", date: dateArg });
if (post.skip) {
  console.log(`告知をスキップ: ${post.skip}`);
  process.exit(0);
}
const text = composeBluesky(post);

// ハッシュタグを Bluesky の tag facet にする（本文中のバイト位置を指定する）
function tagFacets(src) {
  const enc = new TextEncoder();
  const facets = [];
  const re = /#(\S+)/g;
  let m;
  while ((m = re.exec(src))) {
    const byteStart = enc.encode(src.slice(0, m.index)).length;
    facets.push({
      index: { byteStart, byteEnd: byteStart + enc.encode(m[0]).length },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[1] }],
    });
  }
  return facets;
}

if (dryRun) {
  console.log("--- dry-run: 以下の内容を送信します ---");
  console.log(text);
  console.log(`--- ${[...text].length} 文字 / カード: ${post.url} ---`);
  process.exit(0);
}

const handle = process.env.BLUESKY_HANDLE;
const password = process.env.BLUESKY_APP_PASSWORD;
if (!handle || !password) {
  console.error(
    "環境変数 BLUESKY_HANDLE / BLUESKY_APP_PASSWORD を設定してください",
  );
  process.exit(1);
}

async function xrpc(method, token, payload, contentType = "application/json") {
  const res = await fetch(`${PDS}/xrpc/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: contentType === "application/json" ? JSON.stringify(payload) : payload,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} が失敗: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// 1. セッション作成
const session = await xrpc("com.atproto.server.createSession", null, {
  identifier: handle,
  password,
});

// 2. リンクカードのサムネイル（OGP画像）をアップロード。失敗してもサムネ無しで継続。
let thumb;
try {
  const imgRes = await fetch(`${SITE_URL}/og-image.png`);
  if (imgRes.ok) {
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const up = await xrpc(
      "com.atproto.repo.uploadBlob",
      session.accessJwt,
      bytes,
      imgRes.headers.get("content-type") || "image/png",
    );
    thumb = up.blob;
  }
} catch (e) {
  console.warn(`サムネイルの取得に失敗（サムネ無しで継続）: ${e.message}`);
}

// 3. 投稿レコードを作成
const record = {
  $type: "app.bsky.feed.post",
  text,
  createdAt: new Date().toISOString(),
  langs: ["ja"],
  facets: tagFacets(text),
  embed: {
    $type: "app.bsky.embed.external",
    external: {
      uri: post.url,
      title: post.ogTitle,
      description: post.ogDescription,
      ...(thumb ? { thumb } : {}),
    },
  },
};

const created = await xrpc(
  "com.atproto.repo.createRecord",
  session.accessJwt,
  { repo: session.did, collection: "app.bsky.feed.post", record },
);

const rkey = created.uri?.split("/").pop();
console.log(
  `ポスト完了: https://bsky.app/profile/${session.handle}/post/${rkey ?? ""}`,
);
