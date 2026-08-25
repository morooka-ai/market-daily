// 日本株ページの解説（現状・企業の動向）を生成し content/jp-stocks.json に追記する。
// 使い方: node scripts/generate-jp-stocks.mjs
// 夕刊ワークフロー（東証の大引け後）で、generate-featured.mjs のあとに実行する。
//
// 株価は generate-featured.mjs が全銘柄分を書き出しているので、ここでは触らない。
// 解説を作るのは「売買代金上位6銘柄」だけに絞っている。掲載は日経225の223銘柄あるが、
// 未ログインの訪問者（＝検索エンジンのクローラを含む）に見えるのは上位6銘柄なので、
// それ以外の解説を毎日作っても費用に見合わないため。
// 7位以下の銘柄を会員が選んだ場合は、株価のみが表示される（ページ側が解説なしを許容する）。
//
// 方針: 記事本体の生成を妨げないよう、失敗時もできる限り前回値を残す。
//   - 個別銘柄の生成に失敗しても、その銘柄は前回の解説を維持して続行する。
//   - GEMINI_API_KEY 未設定など致命的な場合のみ非ゼロ終了する。
//   - 当日（JST）分が既にある銘柄は作り直さない（generate.mjs と同じ冪等性）。
//     FORCE_REGENERATE=true で強制的に作り直せる。

import fs from "node:fs";
import path from "node:path";
import { JP_STOCKS } from "../src/jp-stocks-data.mjs";
import { defaultVisibleIds } from "../src/catalog.mjs";
import { writeStockNote } from "./lib/stocks.mjs";

const OUT_PATH = path.resolve("content/jp-stocks.json");
const FEATURED_PATH = path.resolve("content/featured.json");
const MARKET_LABEL = "日本の上場企業（東証プライム市場）";
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

  const data = loadJson(OUT_PATH, null);
  if (!data?.stocks) {
    console.warn(
      `${OUT_PATH} がありません。generate-featured.mjs を先に実行してください。解説の生成をスキップします。`,
    );
    return;
  }

  const featured = loadJson(FEATURED_PATH, null);
  const targetIds = defaultVisibleIds("jp-stocks", featured);
  const byTicker = new Map(JP_STOCKS.map((s) => [s.ticker, s]));

  // 当日分が既にある銘柄は作り直さない。Cloud Scheduler の定刻実行のあとに
  // GitHub cron のフォールバックが遅れて発火しても Gemini を呼び直さないため。
  const sameDay =
    !FORCE && Boolean(data.notesGeneratedAt) && jstDay(data.notesGeneratedAt) === jstDay();

  let successCount = 0;
  for (const ticker of targetIds) {
    const stock = byTicker.get(ticker);
    if (!stock) continue;
    if (sameDay && data.stocks[ticker]?.current) {
      console.log(`本日分は生成済み: ${ticker} ${stock.name}`);
      continue;
    }
    try {
      const note = await writeStockNote(stock, MARKET_LABEL);
      data.stocks[ticker] = { ...data.stocks[ticker], ...note };
      successCount++;
      console.log(`生成: ${ticker} ${stock.name}`);
    } catch (err) {
      console.warn(`生成失敗のため前回値を維持: ${ticker} — ${err.message}`);
    }
  }

  // 既定表示から外れた銘柄の解説は、古い内容が残り続けないよう落とす。
  // （会員が選んだ場合は株価のみの表示になる）
  const keep = new Set(targetIds);
  let dropped = 0;
  for (const [ticker, entry] of Object.entries(data.stocks)) {
    if (keep.has(ticker) || !entry.current) continue;
    delete entry.current;
    delete entry.updates;
    dropped++;
  }

  if (successCount === 0 && dropped === 0) {
    console.log("更新はありません。");
    return;
  }

  data.notesGeneratedAt = jstIso();
  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(
    `書き出し完了（新規 ${successCount}銘柄 / 期限切れ ${dropped}銘柄を削除）: ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
