// 米国株ページの解説（現状・企業の動向）を生成し content/us-stocks.json に書き出す。
// 使い方: node scripts/generate-stocks.mjs
// 朝刊ワークフロー（前夜の米国市場を反映）で、generate-featured.mjs のあとに実行する。
//
// 解説を作るのは「売買代金上位6銘柄」だけに絞っている。掲載は S&P100 の101銘柄あるが、
// 未ログインの訪問者（＝検索エンジンのクローラを含む）に見えるのは上位6銘柄なので、
// それ以外の解説を毎日作っても費用に見合わないため。
// 7位以下の銘柄を会員が選んだ場合は、株価とチャートのみが表示される。
//
// 株価・チャートは TradingView のウィジェットが描画するので、このスクリプトは取得しない。
//
// 方針: 記事本体の生成を妨げないよう、失敗時もできる限り前回値を残す。
//   - 個別銘柄の生成に失敗しても、その銘柄は前回の解説を維持して続行する。
//   - GEMINI_API_KEY 未設定など致命的な場合のみ非ゼロ終了する。
//   - 当日（JST）分が既にある銘柄は作り直さない（generate.mjs と同じ冪等性）。
//     FORCE_REGENERATE=true で強制的に作り直せる。

import fs from "node:fs";
import path from "node:path";
import { US_STOCKS } from "../src/us-stocks-data.mjs";
import { defaultVisibleIds } from "../src/catalog.mjs";
import { writeStockNote } from "./lib/stocks.mjs";

const OUT_PATH = path.resolve("content/us-stocks.json");
const FEATURED_PATH = path.resolve("content/featured.json");
const FORCE = process.env.FORCE_REGENERATE === "true";

/** JST の ISO 文字列（+09:00） */
function jstIso() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().replace("Z", "+09:00");
}

/** JST の日付（YYYY-MM-DD） */
function jstDay(value = Date.now()) {
  return new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("環境変数 GEMINI_API_KEY が未設定です");
  }

  const existing = loadJson(OUT_PATH, { stocks: {} });
  const featured = loadJson(FEATURED_PATH, null);
  const targetIds = defaultVisibleIds("us-stocks", featured);
  const byTicker = new Map(US_STOCKS.map((s) => [s.ticker, s]));

  const sameDay =
    !FORCE && Boolean(existing.generatedAt) && jstDay(existing.generatedAt) === jstDay();

  const stocks = {};
  let successCount = 0;

  for (const ticker of targetIds) {
    const stock = byTicker.get(ticker);
    if (!stock) continue;
    const prev = existing.stocks?.[ticker];
    if (sameDay && prev?.current) {
      stocks[ticker] = prev;
      console.log(`本日分は生成済み: ${ticker} ${stock.name}`);
      continue;
    }
    try {
      stocks[ticker] = await writeStockNote(stock);
      successCount++;
      console.log(`生成: ${ticker} ${stock.name}`);
    } catch (err) {
      if (prev) {
        stocks[ticker] = prev;
        console.warn(`生成失敗のため前回値を維持: ${ticker} — ${err.message}`);
      } else {
        console.warn(`生成失敗（前回値なし・スキップ）: ${ticker} — ${err.message}`);
      }
    }
  }

  // 既定表示から外れた銘柄はここで落ちる（stocks に入れ直さないため）。
  // 古い解説が残り続けるのを防ぐ。会員が選んだ場合は株価とチャートのみの表示になる。
  if (successCount === 0 && Object.keys(stocks).length === 0) {
    console.warn("解説を1件も用意できませんでした。既存の内容を保持します。");
    return;
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify({ generatedAt: jstIso(), stocks }, null, 2) + "\n",
    "utf8",
  );
  console.log(
    `書き出し完了（新規 ${successCount}銘柄 / 収録 ${Object.keys(stocks).length}銘柄）: ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
