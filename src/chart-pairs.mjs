// チャートページ（/charts/<id>/）の銘柄定義。
// symbol は TradingView のシンボル。lead はページ冒頭の説明文。
export const CHART_PAIRS = [
  {
    id: "usdjpy",
    symbol: "FX:USDJPY",
    name: "ドル円",
    pair: "USD/JPY",
    lead: "米ドル／日本円（USD/JPY）の為替レートを、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。日本で最も取引量が多い通貨ペアで、日米の金利差や経済指標の影響を受けやすいのが特徴です。",
  },
  {
    id: "eurjpy",
    symbol: "FX:EURJPY",
    name: "ユーロ円",
    pair: "EUR/JPY",
    lead: "ユーロ／日本円（EUR/JPY）の為替レートを、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。欧州経済と日本の金融政策の影響を受ける、取引量の多いクロス円通貨ペアです。",
  },
  {
    id: "gold",
    symbol: "OANDA:XAUUSD",
    name: "ゴールド（金）",
    pair: "XAU/USD",
    lead: "金（ゴールド）のドル建て価格（XAU/USD）を、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。インフレや地政学リスクの局面で買われやすい、代表的な安全資産です。",
  },
  {
    id: "btcjpy",
    symbol: "BITFLYER:BTCJPY",
    name: "ビットコイン円",
    pair: "BTC/JPY",
    lead: "ビットコインの円建て価格（BTC/JPY）を、1分足・30分足・日足の3つの時間軸でリアルタイム表示しています。24時間365日取引される暗号資産の代表格で、値動きの大きさが特徴です。",
  },
];
