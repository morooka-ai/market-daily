// Artifact Registry のクリーンアップポリシーを設定する（初回のみ実行）
//
// デプロイのたびにイメージが1つ増えるため、放置すると無料枠（0.5GB）を使い切る。
// 「最新10世代は必ず残す」＋「30日より古いものは消す」の2本立てで自動整理する。
// KEEP は DELETE より優先されるため、直近10世代は30日を過ぎても消えない。
// Cloud Run は常に最新のイメージで動いているので、稼働中のリビジョンが消えることはない。
//
// 実行:
//   node scripts/setup/artifact-registry-cleanup.mjs            … ポリシーを有効化する
//   node scripts/setup/artifact-registry-cleanup.mjs --dry-run  … 判定だけ行い削除はしない
//                                                                 （結果は Cloud Logging に出る）
//   node scripts/setup/artifact-registry-cleanup.mjs --status   … 現在の設定を表示する
//
// 認証は firebase CLI のトークンを流用する（gcloud CLI 不要）。
// invalid_rapt 等で失敗する場合は `firebase login --reauth` を実行してから再試行。

import fs from "node:fs";
import path from "node:path";

const PROJECT = "market-daily-503003";
const REGION = "asia-northeast1";
const REPOSITORY = "market-daily";

/** 常に残す世代数（デプロイ回数。直近これだけは古くても消さない） */
const KEEP_COUNT = 10;
/** これより古いイメージを削除する（秒）。30日 */
const OLDER_THAN = "2592000s";

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
  if (!j.access_token) {
    throw new Error(
      "トークン取得失敗。`firebase login --reauth` を試してください: " + JSON.stringify(j),
    );
  }
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

const dryRun = process.argv.includes("--dry-run");
const statusOnly = process.argv.includes("--status");

const token = await getToken();
const URL_REPO =
  `https://artifactregistry.googleapis.com/v1` +
  `/projects/${PROJECT}/locations/${REGION}/repositories/${REPOSITORY}`;

function show(repo) {
  console.log(`リポジトリ: ${repo.name}`);
  console.log(`サイズ: ${((repo.sizeBytes ?? 0) / 1024 / 1024).toFixed(1)} MB / 無料枠 500 MB`);
  console.log(`ドライラン: ${repo.cleanupPolicyDryRun ? "有効（削除しない）" : "無効（実際に削除する）"}`);
  const policies = repo.cleanupPolicies;
  if (!policies || !Object.keys(policies).length) {
    console.log("クリーンアップポリシー: 未設定");
    return;
  }
  console.log("クリーンアップポリシー:");
  for (const [name, p] of Object.entries(policies)) {
    const detail = p.mostRecentVersions
      ? `最新 ${p.mostRecentVersions.keepCount} 世代`
      : `${p.condition?.olderThan} より古い（tagState: ${p.condition?.tagState ?? "ANY"}）`;
    console.log(`  - ${name}: ${p.action} / ${detail}`);
  }
}

if (statusOnly) {
  const r = await api(token, "GET", URL_REPO);
  if (r.status !== 200) throw new Error("取得失敗: " + JSON.stringify(r.json));
  show(r.json);
  process.exit(0);
}

const body = {
  cleanupPolicies: {
    "keep-recent": {
      id: "keep-recent",
      action: "KEEP",
      mostRecentVersions: { keepCount: KEEP_COUNT },
    },
    "delete-old": {
      id: "delete-old",
      action: "DELETE",
      condition: { tagState: "ANY", olderThan: OLDER_THAN },
    },
  },
  cleanupPolicyDryRun: dryRun,
};

const r = await api(
  token,
  "PATCH",
  `${URL_REPO}?updateMask=cleanupPolicies,cleanupPolicyDryRun`,
  body,
);
if (r.status !== 200) throw new Error("設定失敗: " + JSON.stringify(r.json));

console.log(dryRun ? "ドライランで設定しました（削除は行われません）" : "設定しました");
console.log("");
show(r.json);
