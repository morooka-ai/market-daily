// 日本株ページに掲載する銘柄の共有リスト（メタ情報のみ）。
// ページ（src/pages/jp-stocks.astro）と解説生成スクリプト
// （scripts/generate-jp-stocks.mjs）の両方がここを参照する。
// 銘柄を追加・変更するときはこの配列を編集する。
// yahooSymbol は Yahoo Finance 形式（証券コード + ".T"）で株価取得に使う。

export const JP_STOCKS = [
  { ticker: "7203", yahooSymbol: "7203.T", name: "トヨタ自動車" },
  { ticker: "6758", yahooSymbol: "6758.T", name: "ソニーグループ" },
  { ticker: "9984", yahooSymbol: "9984.T", name: "ソフトバンクグループ" },
  { ticker: "6861", yahooSymbol: "6861.T", name: "キーエンス" },
  { ticker: "7974", yahooSymbol: "7974.T", name: "任天堂" },
  { ticker: "9432", yahooSymbol: "9432.T", name: "NTT" },
  { ticker: "8306", yahooSymbol: "8306.T", name: "三菱UFJフィナンシャル・グループ" },
  { ticker: "9983", yahooSymbol: "9983.T", name: "ファーストリテイリング" },
  { ticker: "8035", yahooSymbol: "8035.T", name: "東京エレクトロン" },
  { ticker: "6098", yahooSymbol: "6098.T", name: "リクルートホールディングス" },
];
