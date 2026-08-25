// 会員向けメールの送信バッチ。
//
// 使い方:
//   node scripts/send-mail.mjs confirm   … 配信登録の確認メール（保留中のみ）
//   node scripts/send-mail.mjs daily     … 毎日の市況ダイジェスト（配信中のみ）
//   node scripts/send-mail.mjs           … 上記の両方
//
// 必要な環境変数:
//   GOOGLE_APPLICATION_CREDENTIALS もしくは FIREBASE_SERVICE_ACCOUNT … Firestore への接続情報
//                                   （GitHub Actions では Workload Identity 連携で自動設定される）
//   FIREBASE_PROJECT_ID           … Firebase / GCP のプロジェクトID
//   MAIL_PROVIDER / MAIL_API_KEY / MAIL_FROM … 送信サービス（scripts/lib/mailer.mjs 参照）
//   SITE_URL                      … メール内リンクの基準URL
//
// 方針: 1人分の送信に失敗しても全体は止めず、最後に失敗件数を報告する。

import fs from "node:fs";
import path from "node:path";
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  PAGES,
  normalizeSelection,
  defaultVisibleIds,
  DEFAULT_VISIBLE,
} from "../src/catalog.mjs";
import { fetchYahooQuote } from "./lib/market-data.mjs";
import { sendMail, isMailConfigured, mailProviderName } from "./lib/mailer.mjs";

const SITE_URL = (process.env.SITE_URL || "https://market-daily.jimulabo.com").replace(/\/$/, "");
const POSTS_DIR = path.resolve("content/posts");
/** 送信サービスのレート制限に配慮して、1通ごとに置く間隔（ミリ秒） */
const SEND_INTERVAL_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Firestore ---------------------------------------------------------------

function initFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("環境変数 FIREBASE_PROJECT_ID が未設定です");

  // ローカル実行用にサービスアカウントJSONを直接渡せるようにしておく。
  // GitHub Actions では Workload Identity 連携の資格情報が自動で使われる。
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  initializeApp({
    projectId,
    credential: raw ? cert(JSON.parse(raw)) : applicationDefault(),
  });
  return getFirestore();
}

// --- 記事 --------------------------------------------------------------------

/** content/posts から最新の記事（タイトル・URL）を1件返す */
function latestPost() {
  let newest = null;
  let files = [];
  try {
    files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return null;
  }
  for (const file of files) {
    const body = fs.readFileSync(path.join(POSTS_DIR, file), "utf8");
    const title = body.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1];
    const pubDate = body.match(/^pubDate:\s*(.+)\s*$/m)?.[1];
    if (!title || !pubDate) continue;
    const at = new Date(pubDate).getTime();
    if (Number.isNaN(at)) continue;
    if (!newest || at > newest.at) {
      newest = { at, title, url: `${SITE_URL}/posts/${file.replace(/\.md$/, "")}/` };
    }
  }
  return newest;
}

// --- 相場データ --------------------------------------------------------------

/** 銘柄ID → カタログ項目 の逆引き表（ページ単位） */
const ITEM_INDEX = new Map(
  PAGES.map((p) => [p.key, new Map(p.items.map((it) => [it.id, it]))]),
);

/** Yahoo シンボルの現在値をまとめて取得する（同じシンボルは1回だけ問い合わせる） */
async function fetchQuotes(symbols) {
  const quotes = new Map();
  for (const symbol of symbols) {
    try {
      quotes.set(symbol, await fetchYahooQuote(symbol));
    } catch (err) {
      console.warn(`株価取得に失敗（スキップ）: ${symbol} — ${err.message}`);
    }
  }
  return quotes;
}

const CURRENCY_SIGN = { JPY: "¥", USD: "$", EUR: "€", GBP: "£" };

function formatPrice(quote) {
  const v = quote.price;
  const digits = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 2 : 4;
  const num = v.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${CURRENCY_SIGN[quote.currency] ?? ""}${num}`;
}

function formatChange(quote) {
  if (quote.change == null) return "";
  let digits = Math.abs(quote.price) >= 1000 ? 0 : Math.abs(quote.price) >= 10 ? 2 : 4;
  // 変動が小さい銘柄で「+0.00」と表示されてしまわないよう、必要なだけ桁を増やす
  while (digits < 6 && quote.change !== 0 && Math.abs(quote.change) < 10 ** -digits) {
    digits += 2;
  }
  const sign = quote.change >= 0 ? "+" : "";
  const abs = quote.change.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const pct =
    quote.changePercent == null ? "" : ` (${sign}${quote.changePercent.toFixed(2)}%)`;
  return `${sign}${abs}${pct}`;
}

// --- メール本文 --------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** サイトの既定表示と同じ銘柄を選ぶための売買代金ランキング（無ければ手動の既定値が使われる） */
function loadFeatured() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve("content/featured.json"), "utf8"));
  } catch {
    return null;
  }
}
const FEATURED = loadFeatured();

/**
 * 会員の選択銘柄から、配信するセクションを組み立てる。
 * 選択が空のページは既定の6銘柄を送る（何も選んでいない会員にも中身のあるメールを届けるため）。
 * その6銘柄は、サイトの未ログイン時の表示と揃うよう売買代金の上位から採る。
 */
function buildSections(selections) {
  const sections = [];
  for (const page of PAGES) {
    const chosen = normalizeSelection(page.key, selections?.[page.key] ?? []);
    const fallback = page.limited
      ? defaultVisibleIds(page.key, FEATURED)
      : page.items.slice(0, DEFAULT_VISIBLE).map((it) => it.id);
    const ids = chosen.length ? chosen : fallback;
    const items = ids
      .map((id) => ITEM_INDEX.get(page.key).get(id))
      .filter(Boolean);
    if (items.length) sections.push({ label: page.label, items });
  }
  return sections;
}

function renderDigest({ sections, quotes, post, dateLabel, unsubscribeUrl }) {
  const lines = [`${dateLabel} のマーケットまとめをお届けします。`, ""];
  const html = [
    `<p>${esc(dateLabel)} のマーケットまとめをお届けします。</p>`,
  ];

  for (const section of sections) {
    const rows = section.items.map((it) => {
      const q = quotes.get(it.yahooSymbol);
      return {
        name: it.name,
        price: q ? formatPrice(q) : "—",
        change: q ? formatChange(q) : "取得できませんでした",
        up: q?.change != null ? q.change >= 0 : null,
      };
    });

    lines.push(`■ ${section.label}`);
    for (const r of rows) {
      lines.push(`  ${r.name}  ${r.price}  ${r.change}`.trimEnd());
    }
    lines.push("");

    html.push(`<h2 style="font-size:15px;border-left:4px solid #0f5aa8;padding-left:8px;margin:22px 0 8px">${esc(section.label)}</h2>`);
    html.push('<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">');
    for (const r of rows) {
      const color = r.up === null ? "#5b6577" : r.up ? "#1a7f37" : "#cf222e";
      html.push(
        `<tr><td style="padding:4px 8px 4px 0;border-bottom:1px solid #dde3ea">${esc(r.name)}</td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #dde3ea;text-align:right;font-weight:700">${esc(r.price)}</td>` +
          `<td style="padding:4px 0 4px 8px;border-bottom:1px solid #dde3ea;text-align:right;color:${color}">${esc(r.change)}</td></tr>`,
      );
    }
    html.push("</table>");
  }

  if (post) {
    lines.push("▼ 本日の記事", `  ${post.title}`, `  ${post.url}`, "");
    html.push(
      `<h2 style="font-size:15px;border-left:4px solid #0f5aa8;padding-left:8px;margin:22px 0 8px">本日の記事</h2>`,
      `<p style="font-size:14px"><a href="${esc(post.url)}">${esc(post.title)}</a></p>`,
    );
  }

  const footerLines = [
    "──────────────────────",
    "表示する銘柄の変更・配信先の変更はマイページから:",
    `  ${SITE_URL}/account/`,
    "配信を停止する:",
    `  ${unsubscribeUrl}`,
    "",
    "本メールは情報提供のみを目的としたもので、特定の銘柄の売買を推奨するものではありません。",
    "価格は情報提供元の都合により遅延・欠落する場合があります。投資判断はご自身の責任で行ってください。",
    "",
    `発行: マーケットデイリー  ${SITE_URL}/`,
    `お問い合わせ: ${SITE_URL}/contact/`,
  ];

  const footerHtml =
    '<hr style="border:0;border-top:1px solid #dde3ea;margin:24px 0 12px">' +
    '<div style="font-size:12px;color:#5b6577;line-height:1.7">' +
    `<p style="margin:0 0 8px">表示する銘柄の変更・配信先の変更は<a href="${SITE_URL}/account/">マイページ</a>から。` +
    ` 配信の停止は<a href="${esc(unsubscribeUrl)}">こちら</a>。</p>` +
    "<p style=\"margin:0 0 8px\">本メールは情報提供のみを目的としたもので、特定の銘柄の売買を推奨するものではありません。価格は情報提供元の都合により遅延・欠落する場合があります。投資判断はご自身の責任で行ってください。</p>" +
    `<p style="margin:0">発行: マーケットデイリー ${SITE_URL}/ ／ <a href="${SITE_URL}/contact/">お問い合わせ</a></p>` +
    "</div>";

  return {
    text: [...lines, ...footerLines].join("\n"),
    html:
      '<div style="font-family:Hiragino Sans,Yu Gothic,Meiryo,sans-serif;color:#1a2233;line-height:1.7;max-width:640px">' +
      html.join("") +
      footerHtml +
      "</div>",
  };
}

function renderConfirmation({ address, confirmUrl }) {
  const text = [
    "マーケットデイリーの毎日のメール配信にお申し込みいただき、ありがとうございます。",
    "",
    "下のリンクを開き、ページ内のボタンを押すと配信を開始します。",
    "（このリンクを開くまで配信は始まりません）",
    "",
    `  ${confirmUrl}`,
    "",
    `お申し込みのアドレス: ${address}`,
    "",
    "お心当たりがない場合は、このメールを破棄してください。配信は開始されません。",
    "",
    "──────────────────────",
    `発行: マーケットデイリー  ${SITE_URL}/`,
    `お問い合わせ: ${SITE_URL}/contact/`,
  ].join("\n");

  const html =
    '<div style="font-family:Hiragino Sans,Yu Gothic,Meiryo,sans-serif;color:#1a2233;line-height:1.7;max-width:640px">' +
    "<p>マーケットデイリーの毎日のメール配信にお申し込みいただき、ありがとうございます。</p>" +
    "<p>下のボタンから確認ページを開き、ページ内のボタンを押すと配信を開始します。<br>このリンクを開くまで配信は始まりません。</p>" +
    `<p style="margin:20px 0"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#0f5aa8;color:#fff;text-decoration:none;padding:10px 20px;border-radius:5px">配信を開始する</a></p>` +
    `<p style="font-size:13px;color:#5b6577">お申し込みのアドレス: ${esc(address)}<br>お心当たりがない場合は、このメールを破棄してください。配信は開始されません。</p>` +
    '<hr style="border:0;border-top:1px solid #dde3ea;margin:24px 0 12px">' +
    `<p style="font-size:12px;color:#5b6577;margin:0">発行: マーケットデイリー ${SITE_URL}/ ／ <a href="${SITE_URL}/contact/">お問い合わせ</a></p>` +
    "</div>";

  return { text, html };
}

// --- 各モードの処理 ----------------------------------------------------------

const linkFor = (page, uid, token) =>
  `${SITE_URL}/mail/${page}/?u=${encodeURIComponent(uid)}&t=${encodeURIComponent(token)}`;

/** 配信開始の申請を受け付ける期限（これより古い申請は破棄する） */
const CONFIRM_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Firebase の UID として妥当な形か（不正な値でドキュメントパスを壊さないため） */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * 配信開始の申請（mailConfirms）を処理する。
 *
 * 確認ページは users を直接書き換えず、この申請を1件作るだけにしてある。
 * firestore.rules ではトークンの所持を検証できない（書き込み後の姿しか見えず、
 * 送っていないフィールドも保存済みの値として現れる）ため、トークンの照合は
 * Admin SDK で動くここが担当する。照合できた申請だけを配信中に切り替える。
 */
async function applyConfirmations(db) {
  const snap = await db.collection("mailConfirms").get();
  if (snap.empty) return;

  let applied = 0;
  let discarded = 0;

  for (const req of snap.docs) {
    const { uid, token, createdAt } = req.data();
    const at = createdAt?.toMillis?.() ?? 0;
    const fresh = at > 0 && Date.now() - at <= CONFIRM_REQUEST_TTL_MS;
    let ok = false;

    if (fresh && typeof uid === "string" && UID_PATTERN.test(uid) && typeof token === "string") {
      const userRef = db.collection("users").doc(uid);
      const user = await userRef.get();
      const mail = (user.exists ? user.data().mail : null) ?? {};
      // 申し込み直後（pending）のものだけを開始する。本人が停止済み・登録取消済みの
      // 場合に、古いリンクを開いただけで配信が再開されないようにするため。
      if (mail.status === "pending" && mail.token && mail.token === token) {
        await userRef.update({ "mail.status": "subscribed", "mail.confirmedAt": new Date() });
        ok = true;
      }
    }

    // 反映済み・照合できなかった申請はどちらも残しておく理由がないので消す
    await req.ref.delete();
    if (ok) applied++;
    else discarded++;
  }

  console.log(`配信開始の申請: 反映 ${applied}件 / 破棄 ${discarded}件`);
}

/** 配信開始の申請を反映してから、保留中（pending）の会員へ確認メールを送る */
async function runConfirm(db) {
  await applyConfirmations(db);

  const snap = await db.collection("users").where("mail.status", "==", "pending").get();
  let sent = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const mail = doc.data().mail ?? {};
    if (!mail.address || !mail.token) continue;

    // 送信済みで、その後アドレスの再申請もなければ送らない（毎時実行しても重複しない）
    const requestedAt = mail.requestedAt?.toMillis?.() ?? 0;
    const confirmSentAt = mail.confirmSentAt?.toMillis?.() ?? 0;
    if (confirmSentAt && confirmSentAt >= requestedAt) continue;

    const body = renderConfirmation({
      address: mail.address,
      confirmUrl: linkFor("confirm", doc.id, mail.token),
    });
    try {
      await sendMail({
        to: mail.address,
        subject: "【マーケットデイリー】メール配信の確認をお願いします",
        ...body,
      });
      await doc.ref.update({ "mail.confirmSentAt": new Date() });
      sent++;
    } catch (err) {
      failed++;
      console.warn(`確認メールの送信に失敗: ${doc.id} — ${err.message}`);
    }
    await sleep(SEND_INTERVAL_MS);
  }

  console.log(`確認メール: 送信 ${sent}件 / 失敗 ${failed}件（保留中 ${snap.size}件）`);
  return failed;
}

/** 配信中（subscribed）の会員へ当日のダイジェストを送る */
async function runDaily(db) {
  const snap = await db.collection("users").where("mail.status", "==", "subscribed").get();
  if (snap.empty) {
    console.log("配信対象の会員がいません。");
    return 0;
  }

  // 全会員分の銘柄をまとめてから相場データを取りに行く（同じ銘柄の重複取得を避ける）
  const perUser = snap.docs.map((doc) => ({
    doc,
    sections: buildSections(doc.data().selections),
  }));
  const symbols = new Set();
  for (const u of perUser) {
    for (const s of u.sections) for (const it of s.items) symbols.add(it.yahooSymbol);
  }
  console.log(`配信対象 ${perUser.length}件 / 取得銘柄 ${symbols.size}件`);
  const quotes = await fetchQuotes(symbols);

  const post = latestPost();
  const dateLabel = new Date().toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const subject = `【マーケットデイリー】${dateLabel} のマーケット`;

  let sent = 0;
  let failed = 0;
  for (const { doc, sections } of perUser) {
    const mail = doc.data().mail ?? {};
    if (!mail.address || !mail.token) continue;
    const unsubscribeUrl = linkFor("unsubscribe", doc.id, mail.token);
    const body = renderDigest({ sections, quotes, post, dateLabel, unsubscribeUrl });
    try {
      await sendMail({ to: mail.address, subject, unsubscribeUrl, ...body });
      await doc.ref.update({ "mail.lastSentAt": new Date() });
      sent++;
    } catch (err) {
      failed++;
      console.warn(`配信に失敗: ${doc.id} — ${err.message}`);
    }
    await sleep(SEND_INTERVAL_MS);
  }

  console.log(`ダイジェスト: 送信 ${sent}件 / 失敗 ${failed}件`);
  return failed;
}

/**
 * 見本のダイジェストを1通だけ作って送る（Firestore不要）。
 * 送信先は MAIL_TEST_TO。未指定なら console モードと同じく内容を表示するだけ。
 * 配信を有効化する前に、本文の体裁と価格の取得を確認するために使う。
 */
async function runSample() {
  const sections = buildSections({});
  const symbols = new Set(sections.flatMap((s) => s.items.map((it) => it.yahooSymbol)));
  console.log(`見本を作成します（取得銘柄 ${symbols.size}件）`);
  const quotes = await fetchQuotes(symbols);
  const dateLabel = new Date().toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const unsubscribeUrl = linkFor("unsubscribe", "SAMPLE_UID", "SAMPLE_TOKEN");
  const body = renderDigest({
    sections,
    quotes,
    post: latestPost(),
    dateLabel,
    unsubscribeUrl,
  });
  await sendMail({
    to: process.env.MAIL_TEST_TO || "sample@example.com",
    subject: `【マーケットデイリー】${dateLabel} のマーケット（見本）`,
    unsubscribeUrl,
    ...body,
  });
  return 0;
}

// --- エントリポイント ---------------------------------------------------------

async function main() {
  const mode = process.argv[2] ?? "all";
  if (!["all", "confirm", "daily", "sample"].includes(mode)) {
    throw new Error(`不明なモードです: ${mode}（confirm / daily / sample / 省略）`);
  }
  if (!isMailConfigured()) {
    throw new Error("メール送信の設定が未完了です（MAIL_API_KEY / MAIL_FROM）");
  }
  console.log(`送信サービス: ${mailProviderName()} / モード: ${mode}`);

  if (mode === "sample") {
    await runSample();
    return;
  }

  const db = initFirestore();
  let failed = 0;
  if (mode === "all" || mode === "confirm") failed += await runConfirm(db);
  if (mode === "all" || mode === "daily") failed += await runDaily(db);

  // 個別の失敗はワークフローを失敗扱いにしない（記事配信を妨げないため）。
  if (failed) console.warn(`合計 ${failed}件の送信に失敗しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
