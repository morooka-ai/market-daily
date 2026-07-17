// GitHub Actions から Firebase Hosting へデプロイするための認証設定（初回のみ実行）
//
// やること:
//   1. デプロイ用サービスアカウントを作成し、Firebase Hosting Admin 等のロールを付与
//   2. Workload Identity Federation（WIF）の Pool / OIDC Provider を作成
//   3. このリポジトリの GitHub Actions だけがサービスアカウントを使えるように紐付け
//
// 鍵ファイルは作成しません（組織ポリシーで鍵作成が禁止されていても動く、鍵レス構成）。
// 認証は Firebase CLI のログイン情報を流用します。事前に `firebase login` が必要です。
//
// 実行: node scripts/setup/firebase-deploy-auth.mjs
// 完了後、出力される workload_identity_provider / service_account を
// .github/workflows/deploy.yml の google-github-actions/auth@v2 に設定してください。
import fs from "node:fs";
import path from "node:path";

const PROJECT = "market-daily-jimulabo";
const REPO = "morooka-ai/market-daily";
const SA_ID = "github-action-deploy";
const SA_EMAIL = `${SA_ID}@${PROJECT}.iam.gserviceaccount.com`;
const POOL_ID = "github";
const PROVIDER_ID = "github-oidc";
// Firebase CLI に同梱されている公開 OAuth クライアント定数（firebase-tools/lib/api.js より）
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
    throw new Error(
      "アクセストークンの取得に失敗しました。`firebase login` 済みか確認してください: " +
        JSON.stringify(j),
    );
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

// プロジェクト番号を取得
let r = await api(
  token,
  "GET",
  `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`,
);
if (r.status !== 200) throw new Error("project get failed: " + JSON.stringify(r.json));
const PROJECT_NUMBER = r.json.projectNumber;
console.log("project number:", PROJECT_NUMBER);

// 必要な API を有効化（冪等）
for (const svc of [
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "sts.googleapis.com",
]) {
  r = await api(
    token,
    "POST",
    `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/${svc}:enable`,
    {},
  );
  console.log(`enable ${svc}:`, r.status);
}
await sleep(5000);

// サービスアカウント作成（409 = 既存OK。API有効化直後は失敗しうるのでリトライ）
for (let i = 0; i < 5; i++) {
  r = await api(token, "POST", `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts`, {
    accountId: SA_ID,
    serviceAccount: { displayName: "GitHub Actions deploy" },
  });
  if (r.status === 200 || r.status === 409) break;
  console.log(`SA create retry (${r.status})`);
  await sleep(6000);
}
if (r.status === 409) console.log("SA already exists:", SA_EMAIL);
else if (r.status === 200) console.log("SA created:", r.json.email);
else throw new Error("SA create failed: " + JSON.stringify(r.json));

// プロジェクトレベルのロール付与
r = await api(
  token,
  "POST",
  `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,
  {},
);
if (r.status !== 200) throw new Error("getIamPolicy failed: " + JSON.stringify(r.json));
const projPolicy = r.json;
projPolicy.bindings ??= [];
for (const role of ["roles/firebasehosting.admin", "roles/serviceusage.serviceUsageConsumer"]) {
  let b = projPolicy.bindings.find((x) => x.role === role);
  if (!b) projPolicy.bindings.push((b = { role, members: [] }));
  const m = `serviceAccount:${SA_EMAIL}`;
  if (!b.members.includes(m)) b.members.push(m);
}
r = await api(
  token,
  "POST",
  `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:setIamPolicy`,
  { policy: projPolicy },
);
if (r.status !== 200) throw new Error("setIamPolicy failed: " + JSON.stringify(r.json));
console.log("roles granted: firebasehosting.admin, serviceusage.serviceUsageConsumer");

// Workload Identity Pool 作成（409 = 既存OK）
r = await api(
  token,
  "POST",
  `https://iam.googleapis.com/v1/projects/${PROJECT}/locations/global/workloadIdentityPools?workloadIdentityPoolId=${POOL_ID}`,
  { displayName: "GitHub Actions" },
);
if (r.status !== 200 && r.status !== 409)
  throw new Error("pool create failed: " + JSON.stringify(r.json));
console.log("pool:", r.status === 409 ? "already exists" : "created");
if (r.status === 200) await sleep(5000);

// OIDC プロバイダ作成（このリポジトリのトークンだけを受け付ける）
r = await api(
  token,
  "POST",
  `https://iam.googleapis.com/v1/projects/${PROJECT}/locations/global/workloadIdentityPools/${POOL_ID}/providers?workloadIdentityPoolProviderId=${PROVIDER_ID}`,
  {
    displayName: "GitHub OIDC",
    oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
    attributeMapping: {
      "google.subject": "assertion.sub",
      "attribute.repository": "assertion.repository",
    },
    attributeCondition: `assertion.repository == "${REPO}"`,
  },
);
if (r.status !== 200 && r.status !== 409)
  throw new Error("provider create failed: " + JSON.stringify(r.json));
console.log("provider:", r.status === 409 ? "already exists" : "created");

// SA に workloadIdentityUser を付与（このリポジトリの principalSet のみ）
const principal = `principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${REPO}`;
r = await api(
  token,
  "POST",
  `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${SA_EMAIL}:getIamPolicy`,
  {},
);
if (r.status !== 200) throw new Error("SA getIamPolicy failed: " + JSON.stringify(r.json));
const saPolicy = r.json;
saPolicy.bindings ??= [];
let b = saPolicy.bindings.find((x) => x.role === "roles/iam.workloadIdentityUser");
if (!b) saPolicy.bindings.push((b = { role: "roles/iam.workloadIdentityUser", members: [] }));
if (!b.members.includes(principal)) b.members.push(principal);
r = await api(
  token,
  "POST",
  `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${SA_EMAIL}:setIamPolicy`,
  { policy: saPolicy },
);
if (r.status !== 200) throw new Error("SA setIamPolicy failed: " + JSON.stringify(r.json));
console.log("workloadIdentityUser granted to", REPO);

console.log("\n=== deploy.yml に設定する値 ===");
console.log(
  "workload_identity_provider:",
  `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}`,
);
console.log("service_account:", SA_EMAIL);
