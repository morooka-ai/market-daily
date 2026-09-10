// TradingView 埋め込みウィジェットの遅延読み込み。
//
// 一覧・詳細ページはチャートを多数並べるため、全件を即時読み込むと表示が重い。
// 画面内（少し手前）に入ったブロックだけウィジェットのスクリプトを差し込む。
//
// 使う側は data 属性でシンボルを渡し、loadWhenVisible() に mount 関数を組み合わせる。
// 実際の描画は TradingView の外部スクリプトが担うので、ここは「いつ・何を差し込むか」だけ。

const ADVANCED_CHART_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const SYMBOL_INFO_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js";

/** TradingView のウィジェットは「script要素の innerHTML に設定JSON」を置く形で初期化する。 */
function injectWidget(container, src, config) {
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = src;
  script.async = true;
  script.innerHTML = JSON.stringify(config);
  container.appendChild(script);
}

/**
 * 高機能チャート（ローソク足）を container に描画する。
 * @param {Element} container `.tradingview-widget-container`
 * @param {{symbol: string, interval: string, hideTopToolbar?: boolean}} opts
 *   hideTopToolbar: 3列グリッドでは横幅が足りず上部ツールバーの右端が切れるため true にする。
 *   1列表示（詳細ページ）は幅が足りるので false（既定）。
 */
export function mountAdvancedChart(container, { symbol, interval, hideTopToolbar = false }) {
  injectWidget(container, ADVANCED_CHART_SRC, {
    autosize: true,
    symbol,
    interval,
    timezone: "Asia/Tokyo",
    theme: "light",
    style: "1",
    locale: "ja",
    hide_side_toolbar: true,
    hide_top_toolbar: hideTopToolbar,
    allow_symbol_change: false,
    calendar: false,
    support_host: "https://www.tradingview.com",
  });
}

/** 銘柄情報ウィジェット（ロゴ・現在値・主要指標）を container に描画する。 */
export function mountSymbolInfo(container, { symbol }) {
  injectWidget(container, SYMBOL_INFO_SRC, {
    symbol,
    width: "100%",
    locale: "ja",
    colorTheme: "light",
    isTransparent: true,
  });
}

/**
 * targets の各要素が画面内（400px手前）に入ったら、一度だけ load(要素) を呼ぶ。
 * @param {Iterable<Element>} targets
 * @param {(el: Element) => void} load
 */
export function loadWhenVisible(targets, load) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        load(entry.target);
      }
    },
    { rootMargin: "400px 0px" },
  );
  for (const el of targets) observer.observe(el);
}
