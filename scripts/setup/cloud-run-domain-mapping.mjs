// Cloud Run サービスにカスタムドメインをマッピングする（初回のみ実行）
//
// 前提:
//   - ドメイン（jimulabo.com）が Google Search Console で確認済みであること
//   - 実行者（firebase login のアカウント）がその確認済み所有者であること
//
// 実行: node scripts/setup/cloud-run-domain-mapping.mjs
// 完了後、出力される DNS レコードをレジストラの管理画面に追加してください。

import fs from "node:fs";
import path from "node:path";

const PROJECT = "market-daily-503003";
const REGION = "asia-northeast1";
const SERVICE = "market-daily";
const DOMAIN = "market-daily.jimulabo.com";

const CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

async function getToken() {
  const home = process.env.USERPROFILE || process.env.HOME;
  const cs = JSON.parse(
    fs.readFileSync(path.join(home, ".config/configstore/firebase-tools.json"), "utf8"),
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cs.tokens.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const j = await res.json();
  if (!j.access_token)
    throw new Error("トークン取得失敗。`firebase login --reauth` を試してください: " + JSON.stringify(j));
  return j.access_token;
}

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const token = await getToken();
const BASE = `https://${REGION}-run.googleapis.com/apis/domains.cloudrun.com/v1`;

// ドメインマッピング作成（409 = 既存OK）
let r = await api(token, "POST", `${BASE}/namespaces/${PROJECT}/domainmappings`, {
  apiVersion: "domains.cloudrun.com/v1",
  kind: "DomainMapping",
  metadata: { name: DOMAIN, namespace: PROJECT },
  spec: { routeName: SERVICE, certificateMode: "AUTOMATIC" },
});
if (r.status === 409) console.log("mapping: already exists");
else if (r.status === 200) console.log("mapping: created");
else throw new Error("mapping create failed: " + JSON.stringify(r.json));

// ステータス確認（DNSレコード情報が入るまで少し待つ）
for (let i = 0; i < 10; i++) {
  await sleep(3000);
  r = await api(token, "GET", `${BASE}/namespaces/${PROJECT}/domainmappings/${DOMAIN}`);
  const records = r.json?.status?.resourceRecords;
  if (records?.length) {
    console.log("\n=== レジストラのDNS管理画面に追加するレコード ===");
    for (const rec of records) {
      console.log(`  種別: ${rec.type}  名前: ${rec.name || DOMAIN}  値: ${rec.rrdata}`);
    }
    const conds = r.json?.status?.conditions || [];
    console.log("\n現在の状態:");
    for (const c of conds) {
      console.log(`  ${c.type}: ${c.status}${c.message ? ` (${c.message})` : ""}`);
    }
    process.exit(0);
  }
}
console.log("DNSレコード情報の取得を待機中にタイムアウト。再実行してください。");
console.log(JSON.stringify(r.json?.status, null, 2));
