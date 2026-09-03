// 相場データを取得し、未ログイン時に表示する6銘柄を売買代金順で決める。
// 使い方: node scripts/generate-featured.mjs
// 朝刊（米国市場のクローズ後）・夕刊（東証の大引け後）の両方で、解説の生成より先に実行する。
//
// 書き出すもの:
//   content/featured.json  … ページごとの売買代金ランキング（既定表示6銘柄の決定に使う）
//   content/jp-stocks.json … 日本株の株価・前日比
//       東証銘柄はTradingViewの外部埋め込みウィジェットが使えない（ライセンス制限）ため、
//       米国株と違いリアルタイム表示ができない。ここで取得した値をページに静的に埋め込む。
//
// 指標:
//   株式     … 売買代金 ＝ 株価 × 出来高（通貨は現地通貨のまま。順位だけに使うので換算しない）
//   暗号資産 … Yahoo が返す出来高が既に円建ての取引高なので、そのまま使う
//
// APIキーは不要（Yahoo Finance）。日本株225銘柄・米国株101銘柄・暗号資産を
// 順に取得するので1回の実行で約340リクエストになる。
// 銘柄ごとの解説（Gemini）は generate-jp-stocks.mjs / generate-stocks.mjs が
// このファイルの上位6銘柄だけを対象に生成する。
//
// 方針: サイトの表示を妨げないよう、失敗しても既存の値を残す。
//   - 個別銘柄の取得に失敗しても、その銘柄を除いて順位をつける。
//   - 1ページ分がまるごと取れなかった場合は、そのページだけ前回の順位を維持する。
//   - 全ページ失敗しても非ゼロ終了はしない（catalog.mjs 側に手動の既定値があるため、
//     このファイルが無くても未ログインの画面は成立する）。

import fs from "node:fs";
import path from "node:path";
import { PAGES, DEFAULT_VISIBLE } from "../src/catalog.mjs";
import { fetchYahooQuote } from "./lib/market-data.mjs";

const FEATURED_PATH = path.resolve("content/featured.json");
const JP_PATH = path.resolve("content/jp-stocks.json");

/** JST の ISO 文字列（+09:00） */
function jstIso() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().replace("Z", "+09:00");
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** 1ページ分の相場を取得して売買代金順に並べる */
async function fetchPage(page) {
  const rows = [];
  for (const item of page.items) {
    if (!item.yahooSymbol) continue;
    try {
      const quote = await fetchYahooQuote(item.yahooSymbol);
      if (quote.volume == null) continue;
      // 暗号資産は volume がすでに円建ての取引高、株式は 株価 × 出来高
      const turnover =
        page.key === "crypto" ? quote.volume : quote.price * quote.volume;
      if (!Number.isFinite(turnover) || turnover <= 0) continue;
      rows.push({ id: item.id, name: item.name, turnover, quote });
    } catch (err) {
      console.warn(`  取得失敗 ${page.label} ${item.name}: ${err.message}`);
    }
  }
  rows.sort((a, b) => b.turnover - a.turnover);
  return rows;
}

async function main() {
  const existingFeatured = loadJson(FEATURED_PATH, { pages: {} });
  const existingJp = loadJson(JP_PATH, { stocks: {} });
  const pages = {};
  let jpRows = null;
  let failed = 0;

  for (const page of PAGES) {
    if (!page.limited) continue; // FX・貴金属は全件表示のままなので順位は不要

    const rows = await fetchPage(page);

    // 半分も取れていないときは順位が信用できないので、前回の結果を残す
    if (rows.length < Math.max(DEFAULT_VISIBLE, page.items.length / 2)) {
      failed++;
      console.warn(
        `${page.label}: ${page.items.length}銘柄中${rows.length}件しか取得できませんでした。前回の順位を維持します。`,
      );
      if (existingFeatured.pages?.[page.key]) {
        pages[page.key] = existingFeatured.pages[page.key];
      }
      continue;
    }

    pages[page.key] = {
      asOf: rows[0]?.quote?.date ?? null,
      basis: page.basis,
      ranking: rows.map((r) => r.id),
    };
    if (page.key === "jp-stocks") jpRows = rows;

    console.log(
      `${page.label}（${page.basis} / ${rows.length}銘柄中）既定表示: ` +
        rows
          .slice(0, DEFAULT_VISIBLE)
          .map((r, i) => `${i + 1}.${r.name}`)
          .join(" "),
    );
  }

  fs.mkdirSync(path.dirname(FEATURED_PATH), { recursive: true });
  fs.writeFileSync(
    FEATURED_PATH,
    JSON.stringify({ generatedAt: jstIso(), pages }, null, 2) + "\n",
  );

  // 日本株の株価を書き出す。解説（current / updates）は generate-jp-stocks.mjs が
  // あとから上位6銘柄分だけ追記するので、既存の解説はここで消さずに引き継ぐ。
  if (jpRows) {
    const stocks = {};
    for (const row of jpRows) {
      const prev = existingJp.stocks?.[row.id];
      stocks[row.id] = {
        quote: row.quote,
        ...(prev?.current ? { current: prev.current } : {}),
        ...(prev?.updates ? { updates: prev.updates } : {}),
      };
    }
    fs.writeFileSync(
      JP_PATH,
      JSON.stringify({ generatedAt: jstIso(), stocks }, null, 2) + "\n",
    );
    console.log(`日本株の株価を書き出しました（${jpRows.length}銘柄）`);
  }

  console.log(
    `\n書き出し: ${FEATURED_PATH}${failed ? `（${failed}ページは前回値を維持）` : ""}`,
  );
}

await main();
