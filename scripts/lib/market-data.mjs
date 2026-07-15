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
