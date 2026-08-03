// 会員が「表示する銘柄」を選ぶための、ページ横断の銘柄カタログ。
//
// 参照元は3か所:
//   1. 各カテゴリーページ（表示の絞り込み）
//   2. マイページ（選択中の銘柄の一覧表示）
//   3. メール配信スクリプト（scripts/send-mail.mjs）— 現在値の取得に yahooSymbol を使う
//
// 銘柄そのものの定義は chart-pairs.mjs / us-stocks-data.mjs / jp-stocks-data.mjs にあり、
// ここではそれをページ単位に束ね直しているだけ。銘柄の追加・変更は各定義ファイルで行う。

import { FX_PAIRS, METAL_PAIRS, CRYPTO_PAIRS } from "./chart-pairs.mjs";
import { US_STOCKS } from "./us-stocks-data.mjs";
import { JP_STOCKS } from "./jp-stocks-data.mjs";

/** 1ページあたりに選択できる銘柄数の上限 */
export const MAX_SELECTION = 9;

const fromPairs = (pairs) =>
  pairs.map((p) => ({
    id: p.id,
    name: p.name,
    sub: p.pair,
    yahooSymbol: p.yahooSymbol,
  }));

const fromStocks = (stocks) =>
  stocks.map((s) => ({
    id: s.ticker,
    name: s.name,
    sub: s.ticker,
    yahooSymbol: s.yahooSymbol,
  }));

/**
 * ページ単位のカタログ。
 * key    : Firestore の selections に保存するキー。URLパスとも一致させている。
 * label  : 画面表示・メール見出し用のページ名
 * items  : 選択肢（表示順は既定の並び順）
 */
export const PAGES = [
  { key: "fx", label: "FX", path: "fx/", items: fromPairs(FX_PAIRS) },
  { key: "metals", label: "貴金属", path: "metals/", items: fromPairs(METAL_PAIRS) },
  { key: "crypto", label: "暗号資産", path: "crypto/", items: fromPairs(CRYPTO_PAIRS) },
  { key: "jp-stocks", label: "日本株", path: "jp-stocks/", items: fromStocks(JP_STOCKS) },
  { key: "us-stocks", label: "米国株", path: "us-stocks/", items: fromStocks(US_STOCKS) },
];

/** ページキーからカタログを引く */
export function getPage(key) {
  return PAGES.find((p) => p.key === key) ?? null;
}

/**
 * 保存された選択値を検証して正規化する。
 * 未知のID・重複を除き、上限（9件）で切り詰める。
 * 選択が空（=未設定）の場合は空配列を返し、呼び出し側で「全件表示」として扱う。
 */
export function normalizeSelection(pageKey, ids) {
  const page = getPage(pageKey);
  if (!page || !Array.isArray(ids)) return [];
  const valid = new Set(page.items.map((it) => it.id));
  const out = [];
  for (const id of ids) {
    if (typeof id !== "string" || !valid.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_SELECTION) break;
  }
  return out;
}
