// 米国株ページに掲載する銘柄の共有リスト（メタ情報のみ）。
// ページ（src/pages/us-stocks.astro）と解説生成スクリプト
// （scripts/generate-stocks.mjs）の両方がここを参照する。
// 銘柄を追加・変更するときはこの配列を編集する。
// symbol は TradingView 形式（取引所:ティッカー）。

export const US_STOCKS = [
  { ticker: "GOOGL", symbol: "NASDAQ:GOOGL", name: "アルファベット（グーグル）" },
  { ticker: "AMZN", symbol: "NASDAQ:AMZN", name: "アマゾン・ドット・コム" },
  { ticker: "AAPL", symbol: "NASDAQ:AAPL", name: "アップル" },
  { ticker: "SPCX", symbol: "NASDAQ:SPCX", name: "スペースX" },
  { ticker: "LVS", symbol: "NYSE:LVS", name: "ラスベガス・サンズ" },
  { ticker: "RACE", symbol: "NYSE:RACE", name: "フェラーリ" },
];
