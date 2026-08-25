// 市場データの取得
// - Yahoo Finance chart API（キー不要）: 為替・金先物・日経平均
// - Alpha Vantage（無料キー）: 米国株の出来高ランキング

const UA = { headers: { "user-agent": "Mozilla/5.0 (compatible; market-daily-bot)" } };

/**
 * Yahoo Finance chart API から直近営業日の四本値を取得する。
 * 例: "USDJPY=X"（ドル円） "GC=F"（COMEX金先物） "^N225"（日経平均）
 */
export async function fetchYahooDaily(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, UA);
  const json = await res.json().catch(() => null);
  const result = json?.chart?.result?.[0];
  if (!res.ok || !result) {
    throw new Error(`yahoo ${symbol}: ${json?.chart?.error?.description ?? `HTTP ${res.status}`}`);
  }

  const quote = result.indicators?.quote?.[0];
  const timestamps = result.timestamp ?? [];
  let i = timestamps.length - 1;
  while (i >= 0 && quote?.close?.[i] == null) i--;
  if (i < 0) throw new Error(`yahoo ${symbol}: 有効なデータがありません`);

  const gmtoffset = result.meta?.gmtoffset ?? 0;
  const date = new Date((timestamps[i] + gmtoffset) * 1000).toISOString().slice(0, 10);
  const round = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

  return {
    symbol: result.meta?.symbol ?? symbol,
    date, // 取引所現地時間での日付 (YYYY-MM-DD)
    open: round(quote.open[i]),
    high: round(quote.high[i]),
    low: round(quote.low[i]),
    close: round(quote.close[i]),
  };
}

/**
 * Yahoo Finance chart API から現在値・前日比を取得する（日本株など個別銘柄向け）。
 * 例: "7203.T"（トヨタ自動車）
 */
export async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, UA);
  const json = await res.json().catch(() => null);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!res.ok || !meta || meta.regularMarketPrice == null) {
    throw new Error(`yahoo quote ${symbol}: ${json?.chart?.error?.description ?? `HTTP ${res.status}`}`);
  }

  // 前日終値は日足の終値系列から取る。
  // meta.chartPreviousClose は「取得範囲(5日)より前の終値」＝4営業日前を指すため使えない
  // （これを前日終値として扱うと前日比が数日分の変動になってしまう）。
  // 系列の末尾は当日（取引時間中は現在値と同じ）なので、その1つ前の有効な終値が前日終値。
  const closes = (json.chart.result[0].indicators?.quote?.[0]?.close ?? []).filter(
    (v) => v != null,
  );
  const previousClose =
    closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? null);

  const price = meta.regularMarketPrice;
  const change = previousClose != null ? price - previousClose : null;
  const changePercent = previousClose ? (change / previousClose) * 100 : null;
  const date = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10);

  // 出来高。既定表示6銘柄を売買代金順で決めるのに使う（scripts/generate-featured.mjs）。
  // 場中・休場だと当日分が 0 や null になるので、直近の有効値まで遡る。
  const volumes = (json.chart.result[0].indicators?.quote?.[0]?.volume ?? []).filter(
    (v) => v != null && v > 0,
  );
  const volume = volumes.length
    ? volumes[volumes.length - 1]
    : (meta.regularMarketVolume ?? null);

  return {
    symbol: meta.symbol ?? symbol,
    longName: meta.longName ?? meta.shortName ?? null,
    currency: meta.currency ?? null,
    price,
    previousClose,
    change,
    changePercent,
    volume,
    date,
  };
}

/**
 * Alpha Vantage の TOP_GAINERS_LOSERS から米国株の出来高TOP5を取得する。
 * 無料APIキー: https://www.alphavantage.co/support/#api-key
 */
export async function fetchUsMostActives(apiKey) {
  const url = `https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey=${apiKey}`;
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`Alpha Vantage: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.most_actively_traded) {
    throw new Error(`Alpha Vantage: unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    lastUpdated: data.last_updated, // 例: "2026-07-13 16:15:59 US/Eastern"
    mostActives: data.most_actively_traded.slice(0, 5).map((r) => ({
      ticker: r.ticker,
      price: r.price,
      changeAmount: r.change_amount,
      changePercentage: r.change_percentage,
      volume: r.volume,
    })),
  };
}

/** Alpha Vantage の last_updated が古すぎないか（米国市場の休場判定に使う） */
export function isStale(lastUpdated, maxAgeHours = 36) {
  const datePart = String(lastUpdated).split(" ")[0];
  const t = Date.parse(`${datePart}T16:00:00-05:00`); // 米東部の引け時刻ざっくり
  if (Number.isNaN(t)) return false;
  return Date.now() - t > maxAgeHours * 3600 * 1000;
}
