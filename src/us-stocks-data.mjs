// 米国株ページに掲載する銘柄の共有リスト（メタ情報のみ）。
// ページ（src/pages/us-stocks.astro）と解説生成スクリプト
// （scripts/generate-stocks.mjs）の両方がここを参照する。
// 銘柄を追加・変更するときはこの配列を編集する。
// symbol は TradingView 形式（取引所:ティッカー）。
// yahooSymbol は Yahoo Finance 形式（米国株はティッカーそのまま）で、
// 会員向けメール配信の現在値取得に使う。

export const US_STOCKS = [
  { ticker: "GOOGL", symbol: "NASDAQ:GOOGL", yahooSymbol: "GOOGL", name: "アルファベット（グーグル）" },
  { ticker: "AMZN", symbol: "NASDAQ:AMZN", yahooSymbol: "AMZN", name: "アマゾン・ドット・コム" },
  { ticker: "AAPL", symbol: "NASDAQ:AAPL", yahooSymbol: "AAPL", name: "アップル" },
  { ticker: "SPCX", symbol: "NASDAQ:SPCX", yahooSymbol: "SPCX", name: "スペースX" },
  { ticker: "LVS", symbol: "NYSE:LVS", yahooSymbol: "LVS", name: "ラスベガス・サンズ" },
  { ticker: "RACE", symbol: "NYSE:RACE", yahooSymbol: "RACE", name: "フェラーリ" },
  { ticker: "MSFT", symbol: "NASDAQ:MSFT", yahooSymbol: "MSFT", name: "マイクロソフト" },
  { ticker: "NVDA", symbol: "NASDAQ:NVDA", yahooSymbol: "NVDA", name: "エヌビディア" },
  { ticker: "TSLA", symbol: "NASDAQ:TSLA", yahooSymbol: "TSLA", name: "テスラ" },
  { ticker: "META", symbol: "NASDAQ:META", yahooSymbol: "META", name: "メタ・プラットフォームズ" },
  { ticker: "AVGO", symbol: "NASDAQ:AVGO", yahooSymbol: "AVGO", name: "ブロードコム" },
  { ticker: "JPM", symbol: "NYSE:JPM", yahooSymbol: "JPM", name: "JPモルガン・チェース" },
];
