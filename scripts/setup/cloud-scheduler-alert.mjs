// Cloud Scheduler の起動失敗をメールで通知する設定（冪等・再実行OK）
//
// なぜ必要か:
//   2026-08-20 ごろ Cloud Scheduler 用の GitHub PAT が失効し、GitHub の起動 API が 401 を返し続けた。
//   約40日間だれも気づかず、その間は遅延の大きい GitHub cron のフォールバックだけで記事が出ていた
//   （9/28 の夕刊ジョブが日付をまたいで誤ったお知らせを作ったことで発覚）。
//   PAT は無期限で再発行したが、削除・権限変更・GitHub 側の障害でも同じことが起こりうるので、
//   Cloud Scheduler のジョブが失敗したらメールが届くようにする。
//
// やること:
//   1. monitoring API を有効化
//   2. メールの通知チャンネルを作成（同じアドレスのものがあれば再利用）
//   3. ログベースのアラートポリシーを作成/更新
//      条件: Cloud Scheduler のジョブのログに ERROR 以上が出た（AttemptFinished の 401・5xx など）
//      1回の起動で再試行が最大3回走るため、通知は1時間に1通までに抑える
//
// 実行例（通知先は公開リポジトリに書かないよう、環境変数で渡す）:
//   ALERT_EMAIL=you@example.com node scripts/setup/cloud-scheduler-alert.mjs
//   node scripts/setup/cloud-scheduler-alert.mjs --status   … 現在の設定を表示する
//
// 認証は firebase CLI のトークンを流用する（gcloud CLI 不要）。
// invalid_rapt 等で失敗する場合は `firebase login --reauth` を実行してから再試行。

import fs from "node:fs";
import path from "node:path";

const PROJECT = "market-daily-503003";
const POLICY_NAME = "Cloud Scheduler 起動失敗（market-daily）";
const LOG_FILTER = 'resource.type="cloud_scheduler_job" AND severity>=ERROR';

const CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

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
const MON = `https://monitoring.googleapis.com/v3/projects/${PROJECT}`;

async function findPolicy(token) {
  const r = await api(token, "GET", `${MON}/alertPolicies?pageSize=100`);
  if (r.status !== 200) throw new Error(`アラートポリシーの取得に失敗: ${JSON.stringify(r.json)}`);
  return (r.json.alertPolicies ?? []).find((p) => p.displayName === POLICY_NAME);
}

async function status(token) {
  const policy = await findPolicy(token);
  if (!policy) return console.log("アラートポリシーは未設定です。");
  console.log(`ポリシー: ${policy.displayName}（${policy.enabled ? "有効" : "無効"}）`);
  console.log(`  条件: ${policy.conditions?.[0]?.conditionMatchedLog?.filter}`);
  for (const ch of policy.notificationChannels ?? []) {
    const r = await api(token, "GET", `https://monitoring.googleapis.com/v3/${ch}`);
    console.log(`  通知先: ${r.json.labels?.email_address ?? ch}（${r.json.verificationStatus ?? "-"}）`);
  }
}

async function main() {
  const token = await getToken();
  if (process.argv.includes("--status")) return status(token);

  const email = process.env.ALERT_EMAIL;
  if (!email) throw new Error("環境変数 ALERT_EMAIL に通知先のメールアドレスを設定してください。");

  console.log("📡 monitoring API を有効化中...");
  const en = await api(
    token,
    "POST",
    `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/monitoring.googleapis.com:enable`,
    {}
  );
  if (en.status === 200) await sleep(8000);

  // 通知チャンネル（同じアドレスのメールチャンネルがあれば再利用）
  const chs = await api(token, "GET", `${MON}/notificationChannels?pageSize=100`);
  if (chs.status !== 200) throw new Error(`通知チャンネルの取得に失敗: ${JSON.stringify(chs.json)}`);
  let channel = (chs.json.notificationChannels ?? []).find(
    (c) => c.type === "email" && c.labels?.email_address === email
  );
  if (channel) {
    console.log("✓ 既存のメール通知チャンネルを使います");
  } else {
    const cr = await api(token, "POST", `${MON}/notificationChannels`, {
      type: "email",
      displayName: "market-daily 管理者",
      labels: { email_address: email },
    });
    if (cr.status !== 200) throw new Error(`通知チャンネルの作成に失敗: ${JSON.stringify(cr.json)}`);
    channel = cr.json;
    console.log("✅ メール通知チャンネルを作成しました");
  }

  const policy = {
    displayName: POLICY_NAME,
    combiner: "OR",
    enabled: true,
    documentation: {
      mimeType: "text/markdown",
      content:
        "Cloud Scheduler から GitHub の記事生成ワークフローを起動できませんでした。\n\n" +
        "- 401 UNAUTHENTICATED … GitHub の PAT が無効です。PAT を再発行して `.gh-dispatch-token` に保存し、" +
        "`node scripts/setup/cloud-scheduler-trigger.mjs` を実行してください。\n" +
        "- 5xx … GitHub 側の一時的な障害です。次回の起動で回復するか確認してください。\n\n" +
        "起動できなかった回は GitHub cron のフォールバックが遅れて動き、時間帯の外ならスキップされます（記事が欠けます）。",
    },
    conditions: [
      {
        displayName: "Cloud Scheduler のジョブが失敗",
        conditionMatchedLog: { filter: LOG_FILTER },
      },
    ],
    alertStrategy: {
      notificationRateLimit: { period: "3600s" }, // 再試行ぶんのエラーで何通も届かないように
      autoClose: "86400s",
    },
    notificationChannels: [channel.name],
  };

  const existing = await findPolicy(token);
  if (existing) {
    const mask = "display_name,combiner,enabled,documentation,conditions,alert_strategy,notification_channels";
    const up = await api(token, "PATCH", `https://monitoring.googleapis.com/v3/${existing.name}?updateMask=${mask}`, policy);
    if (up.status !== 200) throw new Error(`アラートポリシーの更新に失敗: ${JSON.stringify(up.json)}`);
    console.log("✅ アラートポリシーを更新しました");
  } else {
    const cr = await api(token, "POST", `${MON}/alertPolicies`, policy);
    if (cr.status !== 200) throw new Error(`アラートポリシーの作成に失敗: ${JSON.stringify(cr.json)}`);
    console.log("✅ アラートポリシーを作成しました");
  }
  await status(token);
}

main().catch((err) => {
  console.error("❌ エラー:", err.message);
  process.exit(1);
});
