// 米国株ページの解説（現状・企業の動向）を生成し content/us-stocks.json に書き出す。
// 使い方: node scripts/generate-stocks.mjs
// 朝刊ワークフロー（前夜の米国市場を反映）と同じタイミングで実行する。
//
// 方針: 記事本体の生成を妨げないよう、失敗時もできる限り前回値を残す。
//   - 個別銘柄の生成に失敗しても、その銘柄は前回の解説を維持して続行する。
//   - GEMINI_API_KEY 未設定など致命的な場合のみ非ゼロ終了する。

import fs from "node:fs";
import path from "node:path";
import { US_STOCKS } from "../src/us-stocks-data.mjs";
import { writeStockNote } from "./lib/stocks.mjs";

const OUT_PATH = path.resolve("content/us-stocks.json");

// JST の ISO 文字列（+09:00）を返す
function jstIso() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().replace("Z", "+09:00");
}

// 既存の解説を読み込む（生成失敗時のフォールバック用）
function loadExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
  } catch {
    return { stocks: {} };
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("環境変数 GEMINI_API_KEY が未設定です");
  }

  const existing = loadExisting();
  const stocks = {};
  let successCount = 0;

  for (const s of US_STOCKS) {
    try {
      const note = await writeStockNote(s);
      stocks[s.ticker] = note;
      successCount++;
      console.log(`生成: ${s.ticker}`);
    } catch (err) {
      const prev = existing.stocks?.[s.ticker];
      if (prev) {
        stocks[s.ticker] = prev;
        console.warn(`生成失敗のため前回値を維持: ${s.ticker} — ${err.message}`);
      } else {
        console.warn(`生成失敗（前回値なし・スキップ）: ${s.ticker} — ${err.message}`);
      }
    }
  }

  if (successCount === 0) {
    // 全滅した場合は既存ファイルを上書きしない（前回の解説を保持）
    console.warn("全銘柄の生成に失敗しました。既存の解説を保持します。");
    return;
  }

  const out = { generatedAt: jstIso(), stocks };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`書き出し完了（${successCount}/${US_STOCKS.length}銘柄）: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
