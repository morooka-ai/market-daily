// GitHub Actions から Google Cloud Run へデプロイするための WIF 認証設定（初回のみ実行）
//
// やること:
//   1. Service Account を作成（既に github-action-deploy で作成済みのはず）
//   2. Cloud Run Admin / Service Account User ロールを付与
//   3. Workload Identity Federation（WIF）の Pool / OIDC Provider を作成
//   4. GitHub Actions だけがサービスアカウントを使えるように紐付け
//
// 前提: Firebase CLI がインストール済みで、`firebase login` で認証済みであること
// 実行: node scripts/setup/cloud-run-deploy-auth.mjs
// 完了後、出力される workload_identity_provider / service_account を
// .github/workflows/deploy-cloud-run.yml に設定してください。

import fs from "node:fs";
import path from "node:path";

const PROJECT = "market-daily-503003";
const REPO = "morooka-ai/market-daily";
const SA_ID = "github-action-deploy";
const SA_EMAIL = `${SA_ID}@${PROJECT}.iam.gserviceaccount.com`;
const POOL_ID = "github";
const PROVIDER_ID = "github-oidc";

// Firebase CLI に同梱されている公開 OAuth クライアント定数
const CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

async function getToken() {
  const home = process.env.USERPROFILE || process.env.HOME;
  const configPath = path.join(home, ".config/configstore/firebase-tools.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Firebase CLI の設定が見つかりません: ${configPath}\n` +
      "事前に `firebase login` を実行してください。"
    );
  }

  const cs = JSON.parse(fs.readFileSync(configPath, "utf8"));
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
        JSON.stringify(j)
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

async function main() {
  console.log("🔧 Cloud Run デプロイ認証を設定中...\n");

  const token = await getToken();
  console.log("✅ Firebase CLI トークン取得成功\n");

  // プロジェクト番号を取得
  let r = await api(
    token,
    "GET",
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`
  );
  if (r.status !== 200) throw new Error("project get failed: " + JSON.stringify(r.json));
  const PROJECT_NUMBER = r.json.projectNumber;
  console.log(`📌 Project Number: ${PROJECT_NUMBER}`);
  console.log(`📌 Project ID: ${PROJECT}`);
  console.log(`📌 Service Account: ${SA_EMAIL}\n`);

  // 必要な API を有効化（冪等）
  console.log("📡 Google APIs を有効化中...");
  for (const svc of [
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
  ]) {
    r = await api(
      token,
      "POST",
      `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/${svc}:enable`,
      {}
    );
    console.log(`  ${svc}: ${r.status === 200 ? "✅ enabled" : "✓ already enabled"}`);
  }
  await sleep(5000);

  // Service Account は既に作成済みのはずなので、IAM ロール付与のみ
  console.log(`\n🔐 IAM ロールを付与中...`);
  r = await api(
    token,
    "POST",
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,
    {}
  );
  if (r.status !== 200) throw new Error("getIamPolicy failed: " + JSON.stringify(r.json));
  const projPolicy = r.json;
  projPolicy.bindings ??= [];

  // Cloud Run Admin と Service Account User を付与
  for (const role of [
    "roles/run.admin",
    "roles/iam.serviceAccountUser",
    "roles/serviceusage.serviceUsageConsumer",
    "roles/artifactregistry.writer"
  ]) {
    let b = projPolicy.bindings.find((x) => x.role === role);
    if (!b) projPolicy.bindings.push((b = { role, members: [] }));
    const m = `serviceAccount:${SA_EMAIL}`;
    if (!b.members.includes(m)) b.members.push(m);
    console.log(`  ${role.split("/")[1]}: ✅`);
  }

  r = await api(
    token,
    "POST",
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:setIamPolicy`,
    { policy: projPolicy }
  );
  if (r.status !== 200) throw new Error("setIamPolicy failed: " + JSON.stringify(r.json));

  // Workload Identity Pool 作成（409 = 既存OK）
  console.log(`\n🔗 Workload Identity Pool を作成中...`);
  r = await api(
    token,
    "POST",
    `https://iam.googleapis.com/v1/projects/${PROJECT}/locations/global/workloadIdentityPools?workloadIdentityPoolId=${POOL_ID}`,
    { displayName: "GitHub Actions" }
  );
  if (r.status !== 200 && r.status !== 409)
    throw new Error("pool create failed: " + JSON.stringify(r.json));
  console.log(`  Pool: ${r.status === 409 ? "✓ already exists" : "✅ created"}`);
  if (r.status === 200) await sleep(5000);

  // OIDC プロバイダ作成
  console.log(`\n🔗 OIDC Provider を作成中...`);
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
    }
  );
  if (r.status !== 200 && r.status !== 409)
    throw new Error("provider create failed: " + JSON.stringify(r.json));
  console.log(`  Provider: ${r.status === 409 ? "✓ already exists" : "✅ created"}`);

  // SA に workloadIdentityUser を付与
  console.log(`\n🔑 Service Account に権限を付与中...`);
  const principal = `principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${REPO}`;
  r = await api(
    token,
    "POST",
    `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${SA_EMAIL}:getIamPolicy`,
    {}
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
    { policy: saPolicy }
  );
  if (r.status !== 200) throw new Error("SA setIamPolicy failed: " + JSON.stringify(r.json));
  console.log(`  workloadIdentityUser: ✅ granted`);

  // Artifact Registry リポジトリ作成（コンテナイメージの保存先。409 = 既存OK）
  console.log(`\n📦 Artifact Registry リポジトリを作成中...`);
  r = await api(
    token,
    "POST",
    `https://artifactregistry.googleapis.com/v1/projects/${PROJECT}/locations/asia-northeast1/repositories?repositoryId=market-daily`,
    { format: "DOCKER", description: "market-daily container images" }
  );
  if (r.status !== 200 && r.status !== 409)
    throw new Error("AR repo create failed: " + JSON.stringify(r.json));
  console.log(`  Repository: ${r.status === 409 ? "✓ already exists" : "✅ created"}`);

  console.log("\n" + "=".repeat(60));
  console.log("✨ セットアップ完了！\n");
  console.log("📋 以下の値を .github/workflows/deploy-cloud-run.yml に設定してください：\n");
  console.log(
    "workload_identity_provider:",
    `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}`
  );
  console.log("service_account:", SA_EMAIL);
  console.log("\n" + "=".repeat(60));
}

main().catch((err) => {
  console.error("❌ エラー:", err.message);
  process.exit(1);
});
