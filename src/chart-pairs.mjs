// チャートページの銘柄定義。
// category: "fx" | "crypto"。symbol は TradingView のシンボル。lead は詳細ページ冒頭の説明文。
export const CHART_PAIRS = [
  {
    id: "usdjpy",
    category: "fx",
    symbol: "FX:USDJPY",
    name: "ドル円",
    pair: "USD/JPY",
    lead: "米ドル／日本円（USD/JPY）の為替レートを、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。日本で最も取引量が多い通貨ペアで、日米の金利差や経済指標の影響を受けやすいのが特徴です。",
  },
  {
    id: "eurjpy",
    category: "fx",
    symbol: "FX:EURJPY",
    name: "ユーロ円",
    pair: "EUR/JPY",
    lead: "ユーロ／日本円（EUR/JPY）の為替レートを、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。欧州経済と日本の金融政策の影響を受ける、取引量の多いクロス円通貨ペアです。",
  },
  {
    id: "gbpjpy",
    category: "fx",
    symbol: "FX:GBPJPY",
    name: "ポンド円",
    pair: "GBP/JPY",
    lead: "英ポンド／日本円（GBP/JPY）の為替レートを、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。クロス円の中でも値動きが大きく、ボラティリティを活かした短期売買で人気の通貨ペアです。",
  },
  {
    id: "chfjpy",
    category: "fx",
    symbol: "FX:CHFJPY",
    name: "CHF円",
    pair: "CHF/JPY",
    lead: "スイスフラン／日本円（CHF/JPY）の為替レートを、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。安全資産とされるスイスフランと円の組み合わせで、リスクオフ局面の動向が注目される通貨ペアです。",
  },
  {
    id: "audjpy",
    category: "fx",
    symbol: "FX:AUDJPY",
    name: "AUD円",
    pair: "AUD/JPY",
    lead: "豪ドル／日本円（AUD/JPY）の為替レートを、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。資源国通貨の代表格で、中国経済や商品市況の影響を受けやすい通貨ペアです。",
  },
  {
    id: "nzdjpy",
    category: "fx",
    symbol: "FX:NZDJPY",
    name: "NZD円",
    pair: "NZD/JPY",
    lead: "NZドル／日本円（NZD/JPY）の為替レートを、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。乳製品など一次産品の市況とNZの金融政策の影響を受けるオセアニア通貨です。",
  },
  {
    id: "gold",
    category: "fx",
    symbol: "OANDA:XAUUSD",
    name: "ゴールド（金）",
    pair: "XAU/USD",
    lead: "金（ゴールド）のドル建て価格（XAU/USD）を、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。インフレや地政学リスクの局面で買われやすい、代表的な安全資産です。",
  },
  {
    id: "btcjpy",
    category: "crypto",
    symbol: "BITFLYER:BTCJPY",
    name: "ビットコイン円",
    pair: "BTC/JPY",
    lead: "ビットコインの円建て価格（BTC/JPY）を、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。24時間365日取引される暗号資産の代表格で、値動きの大きさが特徴です。",
  },
  {
    id: "ethjpy",
    category: "crypto",
    symbol: "BITFLYER:ETHJPY",
    name: "イーサリアム円",
    pair: "ETH/JPY",
    lead: "イーサリアムの円建て価格（ETH/JPY）を、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。スマートコントラクト基盤の代表格で、ビットコインに次ぐ時価総額を持つ暗号資産です。",
  },
  {
    id: "xrpjpy",
    category: "crypto",
    symbol: "BITFLYER:XRPJPY",
    name: "XRP円",
    pair: "XRP/JPY",
    lead: "XRP（リップル）の円建て価格（XRP/JPY）を、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。国際送金分野での活用が注目される、日本でも取引量の多い暗号資産です。",
  },
];

export const FX_PAIRS = CHART_PAIRS.filter((p) => p.category === "fx");
export const CRYPTO_PAIRS = CHART_PAIRS.filter((p) => p.category === "crypto");
