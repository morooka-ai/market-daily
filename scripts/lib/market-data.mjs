// 市場データの取得
// - Yahoo Finance chart API（キー不要）: 為替・金先物・株価指数・個別株
//
// 米国株のランキングは以前 Alpha Vantage の出来高上位（most_actively_traded）を使っていたが、
// 1ドル未満の超低位株やレバレッジETFばかりが並び読者の役に立たなかったため、
// 2026-09-29 に S&P 100 構成銘柄の売買代金ランキング（fetchUsTurnoverTop）へ切り替えた。

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

  // 前日終値＝最新の有効な足の1つ前の有効な終値（休場日の null は飛ばす）
  let j = i - 1;
  while (j >= 0 && quote.close[j] == null) j--;
  const prevClose = j >= 0 ? quote.close[j] : null;
  const close = quote.close[i];
  const change = prevClose != null ? close - prevClose : null;

  return {
    symbol: result.meta?.symbol ?? symbol,
    date, // 取引所現地時間での日付 (YYYY-MM-DD)
    open: round(quote.open[i]),
    high: round(quote.high[i]),
    low: round(quote.low[i]),
    close: round(close),
    prevClose: round(prevClose),
    change: round(change),
    changePercent: prevClose ? round2((change / prevClose) * 100) : null,
  };
}

const round = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/** 前日比を「+1.23（+0.45%）」の形で書く。前日値が無ければ「—」 */
export function formatChange(q) {
  if (q.change == null) return "—";
  const sign = (v) => (v > 0 ? "+" : "");
  return `${sign(q.change)}${q.change}（${sign(q.changePercent)}${q.changePercent}%）`;
}

/**
 * Yahoo Finance から直近1か月の日足（日付・四本値）を取得する。週間まとめに使う。
 */
export async function fetchYahooSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
  const res = await fetch(url, UA);
  const json = await res.json().catch(() => null);
  const result = json?.chart?.result?.[0];
  if (!res.ok || !result) {
    throw new Error(`yahoo ${symbol}: ${json?.chart?.error?.description ?? `HTTP ${res.status}`}`);
  }
  const quote = result.indicators?.quote?.[0] ?? {};
  const gmtoffset = result.meta?.gmtoffset ?? 0;
  return (result.timestamp ?? [])
    .map((t, k) => ({
      date: new Date((t + gmtoffset) * 1000).toISOString().slice(0, 10),
      open: quote.open?.[k],
      high: quote.high?.[k],
      low: quote.low?.[k],
      close: quote.close?.[k],
    }))
    .filter((r) => r.close != null && r.high != null && r.low != null);
}

/**
 * S&P 100 構成銘柄（src/us-stocks-data.mjs）を売買代金（株価×出来高）順に並べ、上位 n 件を返す。
 * 101銘柄を並列8本で取得する（Yahoo Finance、キー不要）。
 * 最新の取引日（全銘柄で最も多い日付）のデータだけを順位の対象にする。
 */
export async function fetchUsTurnoverTop(stocks, n = 5) {
  const rows = [];
  const queue = [...stocks];
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try {
        const q = await fetchYahooQuote(s.yahooSymbol);
        if (q.volume == null || !q.price) continue;
        rows.push({ ...s, quote: q, turnover: q.price * q.volume });
      } catch (err) {
        console.warn(`  取得失敗 ${s.ticker}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  if (rows.length < stocks.length / 2) {
    throw new Error(`米国株の取得件数が少なすぎます（${rows.length}/${stocks.length}）`);
  }
  const counts = {};
  for (const r of rows) counts[r.quote.date] = (counts[r.quote.date] ?? 0) + 1;
  const date = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  const top = rows
    .filter((r) => r.quote.date === date)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, n);
  return { date, count: rows.length, top };
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

/** 米国市場の最新取引日（YYYY-MM-DD）が古すぎないか（米国市場の休場判定に使う） */
export function isStale(lastDate, maxAgeHours = 36) {
  const datePart = String(lastDate).split(" ")[0];
  const t = Date.parse(`${datePart}T16:00:00-05:00`); // 米東部の引け時刻ざっくり
  if (Number.isNaN(t)) return false;
  return Date.now() - t > maxAgeHours * 3600 * 1000;
}
