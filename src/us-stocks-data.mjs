// 米国株ページに掲載する銘柄の共有リスト（メタ情報のみ）。
// ページ（src/pages/us-stocks.astro）と各生成スクリプトがここを参照する。
// symbol は TradingView 形式（取引所:ティッカー）。
// yahooSymbol は Yahoo Finance 形式（米国株はティッカーそのまま）で、
// 売買代金の順位づけと会員向けメール配信の現在値取得に使う。
//
// 母集団はダウ工業株30種平均（DJIA）の構成銘柄。既定表示（未ログイン時の6銘柄）は
// content/featured.json の売買代金順で毎日決まるため、ここでの並び順は
// 「選択パネルでの並び」以上の意味を持たない（ティッカー順にしてある）。
//
// 取引所プレフィックスは TradingView のシンボル検索APIで全銘柄を実在確認済み（2026-08-25）。
// 直感に反するものがあるので、追加・変更時は必ず確認すること
// （WMT・HON は NYSE ではなく NASDAQ）。
//
// 構成銘柄の入れ替えは不定期。直近ではアルファベット(GOOGL)が2026年6月29日に採用された。

export const US_STOCKS = [
  { ticker: "AAPL", symbol: "NASDAQ:AAPL", yahooSymbol: "AAPL", name: "アップル" },
  { ticker: "AMGN", symbol: "NASDAQ:AMGN", yahooSymbol: "AMGN", name: "アムジェン" },
  { ticker: "AMZN", symbol: "NASDAQ:AMZN", yahooSymbol: "AMZN", name: "アマゾン・ドット・コム" },
  { ticker: "AXP", symbol: "NYSE:AXP", yahooSymbol: "AXP", name: "アメリカン・エキスプレス" },
  { ticker: "BA", symbol: "NYSE:BA", yahooSymbol: "BA", name: "ボーイング" },
  { ticker: "CAT", symbol: "NYSE:CAT", yahooSymbol: "CAT", name: "キャタピラー" },
  { ticker: "CRM", symbol: "NYSE:CRM", yahooSymbol: "CRM", name: "セールスフォース" },
  { ticker: "CSCO", symbol: "NASDAQ:CSCO", yahooSymbol: "CSCO", name: "シスコシステムズ" },
  { ticker: "CVX", symbol: "NYSE:CVX", yahooSymbol: "CVX", name: "シェブロン" },
  { ticker: "DIS", symbol: "NYSE:DIS", yahooSymbol: "DIS", name: "ウォルト・ディズニー" },
  { ticker: "GOOGL", symbol: "NASDAQ:GOOGL", yahooSymbol: "GOOGL", name: "アルファベット（グーグル）" },
  { ticker: "GS", symbol: "NYSE:GS", yahooSymbol: "GS", name: "ゴールドマン・サックス" },
  { ticker: "HD", symbol: "NYSE:HD", yahooSymbol: "HD", name: "ホーム・デポ" },
  { ticker: "HON", symbol: "NASDAQ:HON", yahooSymbol: "HON", name: "ハネウェル・インターナショナル" },
  { ticker: "IBM", symbol: "NYSE:IBM", yahooSymbol: "IBM", name: "IBM" },
  { ticker: "JNJ", symbol: "NYSE:JNJ", yahooSymbol: "JNJ", name: "ジョンソン・エンド・ジョンソン" },
  { ticker: "JPM", symbol: "NYSE:JPM", yahooSymbol: "JPM", name: "JPモルガン・チェース" },
  { ticker: "KO", symbol: "NYSE:KO", yahooSymbol: "KO", name: "コカ・コーラ" },
  { ticker: "MCD", symbol: "NYSE:MCD", yahooSymbol: "MCD", name: "マクドナルド" },
  { ticker: "MMM", symbol: "NYSE:MMM", yahooSymbol: "MMM", name: "スリーエム" },
  { ticker: "MRK", symbol: "NYSE:MRK", yahooSymbol: "MRK", name: "メルク" },
  { ticker: "MSFT", symbol: "NASDAQ:MSFT", yahooSymbol: "MSFT", name: "マイクロソフト" },
  { ticker: "NKE", symbol: "NYSE:NKE", yahooSymbol: "NKE", name: "ナイキ" },
  { ticker: "NVDA", symbol: "NASDAQ:NVDA", yahooSymbol: "NVDA", name: "エヌビディア" },
  { ticker: "PG", symbol: "NYSE:PG", yahooSymbol: "PG", name: "プロクター・アンド・ギャンブル" },
  { ticker: "SHW", symbol: "NYSE:SHW", yahooSymbol: "SHW", name: "シャーウィン・ウィリアムズ" },
  { ticker: "TRV", symbol: "NYSE:TRV", yahooSymbol: "TRV", name: "トラベラーズ" },
  { ticker: "UNH", symbol: "NYSE:UNH", yahooSymbol: "UNH", name: "ユナイテッドヘルス・グループ" },
  { ticker: "V", symbol: "NYSE:V", yahooSymbol: "V", name: "ビザ" },
  { ticker: "WMT", symbol: "NASDAQ:WMT", yahooSymbol: "WMT", name: "ウォルマート" },
];
