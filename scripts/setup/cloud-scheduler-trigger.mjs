// GitHub Actions の記事生成ワークフローを Cloud Scheduler から定時トリガーする設定（冪等・再実行OK）
//
// なぜ必要か:
//   GitHub Actions の schedule(cron) は「ベストエフォート」で、混雑時に数時間遅延・
//   丸ごと脱落することがある（実際に自動更新が止まった）。Cloud Scheduler は時刻が
//   正確なので、こちらを主トリガーにして GitHub の workflow_dispatch API を叩く。
//   GitHub 側の schedule はフォールバックとして残す（generate.mjs が冪等なので二重投稿にはならない）。
//
// やること:
//   1. cloudscheduler API を有効化
//   2. asia-northeast1 に 2 つのジョブを作成/更新（朝刊 7:30 / 夕刊 16:00, Asia/Tokyo）
//      各ジョブは GitHub の workflow_dispatch エンドポイントへ POST する
//
// 前提:
//   - Firebase CLI が `firebase login` 済み（GCP API 認証に流用。gcloud CLI 不要）
//   - GitHub の Fine-grained PAT を環境変数 GH_DISPATCH_TOKEN に設定
//     対象リポジトリ: morooka-ai/market-daily / 権限: Actions = Read and write
//
// 実行例:
//   GH_DISPATCH_TOKEN=github_pat_xxx node scripts/setup/cloud-scheduler-trigger.mjs
//
// 注意: PAT はジョブの HTTP ヘッダに平文で保存される（プロジェクトのオーナーのみ閲覧可）。
//       権限は当リポジトリの Actions のみに絞った Fine-grained PAT を使うこと。

import fs from "node:fs";
import path from "node:path";

const PROJECT = "market-daily-503003";
const LOCATION = "asia-northeast1";
const REPO = "morooka-ai/market-daily";

// Firebase CLI 同梱の公開 OAuth クライアント定数（GCP API 認証に流用）
const CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

// トークンは (1) 環境変数 GH_DISPATCH_TOKEN、(2) プロジェクト直下の .gh-dispatch-token
// （gitignore 済み）の順に探す。ファイル方式ならコマンドライン履歴に PAT が残らない。
function loadGhToken() {
  if (process.env.GH_DISPATCH_TOKEN) return process.env.GH_DISPATCH_TOKEN.trim();
  const tokenFile = path.resolve(".gh-dispatch-token");
  if (fs.existsSync(tokenFile)) {
    const t = fs.readFileSync(tokenFile, "utf8").trim();
    if (t) return t;
  }
  return null;
}

const GH_TOKEN = loadGhToken();
if (!GH_TOKEN) {
  console.error(
    "❌ GitHub PAT が見つかりません。次のいずれかで渡してください:\n" +
      "   (A) プロジェクト直下に .gh-dispatch-token を作成し PAT を1行で保存（推奨・gitignore済み）\n" +
      "   (B) 環境変数 GH_DISPATCH_TOKEN に設定\n" +
      "   PAT は Fine-grained（morooka-ai/market-daily の Actions=Read and write）を使うこと。"
  );
  process.exit(1);
}

// 各ジョブ定義。schedule は Asia/Tokyo。GitHub 側 cron と曜日を揃えている
// （朝刊=火〜土 / 夕刊=月〜金）。実際の休場判定は generate.mjs が行う。
const JOBS = [
  {
    id: "market-daily-morning",
    schedule: "30 7 * * 2-6",
    workflow: "post-morning.yml",
    desc: "朝刊を生成（毎朝7:30 JST / GitHub workflow_dispatch）",
  },
  {
    id: "market-daily-evening",
    schedule: "0 16 * * 1-5",
    workflow: "post-evening.yml",
    desc: "夕刊を生成（毎夕16:00 JST / GitHub workflow_dispatch）",
  },
];

async function getToken() {
  const home = process.env.USERPROFILE || process.env.HOME;
  const configPath = path.join(home, ".config/configstore/firebase-tools.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Firebase CLI の設定が見つかりません: ${configPath}\n事前に \`firebase login\` を実行してください。`
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
      "アクセストークンの取得に失敗しました。`firebase login --reauth` を試してください: " +
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

function jobPayload(job, jobName) {
  return {
    name: jobName,
    description: job.desc,
    schedule: job.schedule,
    timeZone: "Asia/Tokyo",
    retryConfig: { retryCount: 3, minBackoffDuration: "30s", maxBackoffDuration: "300s" },
    httpTarget: {
      uri: `https://api.github.com/repos/${REPO}/actions/workflows/${job.workflow}/dispatches`,
      httpMethod: "POST",
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cloud-scheduler-market-daily",
        "Content-Type": "application/json",
      },
      // GitHub workflow_dispatch は body に {"ref":"main"} を要求。API では base64 で渡す。
      body: Buffer.from(JSON.stringify({ ref: "main" }), "utf8").toString("base64"),
    },
  };
}

async function main() {
  console.log("🔧 Cloud Scheduler トリガーを設定中...\n");

  const token = await getToken();
  console.log("✅ Firebase CLI トークン取得成功\n");

  // cloudscheduler API を有効化（冪等）
  console.log("📡 cloudscheduler API を有効化中...");
  let r = await api(
    token,
    "POST",
    `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/cloudscheduler.googleapis.com:enable`,
    {}
  );
  console.log(`  cloudscheduler.googleapis.com: ${r.status === 200 ? "✅ enabled" : "✓ already enabled"}`);
  if (r.status === 200) await sleep(8000);

  const base = `https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/jobs`;

  for (const job of JOBS) {
    const jobName = `projects/${PROJECT}/locations/${LOCATION}/jobs/${job.id}`;
    console.log(`\n🕒 ${job.id}（${job.schedule} Asia/Tokyo）`);

    // 既存確認
    const get = await api(token, "GET", `${base}/${job.id}`);
    const payload = jobPayload(job, jobName);

    if (get.status === 200) {
      // PATCH で更新（変更しうる全フィールドを updateMask で指定）
      const mask = "schedule,timeZone,description,retryConfig,httpTarget";
      const upd = await api(token, "PATCH", `${base}/${job.id}?updateMask=${mask}`, payload);
      if (upd.status !== 200)
        throw new Error(`ジョブ更新に失敗: ${JSON.stringify(upd.json)}`);
      console.log(`  ✅ 更新しました`);
    } else if (get.status === 404) {
      const cre = await api(token, "POST", base, payload);
      if (cre.status !== 200)
        throw new Error(`ジョブ作成に失敗: ${JSON.stringify(cre.json)}`);
      console.log(`  ✅ 作成しました`);
    } else {
      throw new Error(`ジョブ確認に失敗 (${get.status}): ${JSON.stringify(get.json)}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✨ 完了！Cloud Scheduler が定時に GitHub ワークフローを起動します。");
  console.log("   動作テスト: ジョブを今すぐ実行するには Cloud Scheduler コンソール、または");
  console.log(`   本スクリプトと同じ認証で ${base}/<jobId>:run を POST してください。`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("❌ エラー:", err.message);
  process.exit(1);
});
