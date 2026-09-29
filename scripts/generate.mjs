// 記事の自動生成エントリポイント
// 使い方: node scripts/generate.mjs morning | evening [--force]
//   --force … 下記の「生成してよい時間帯」の判定を無視する（手動での動作確認用）

import fs from "node:fs";
import path from "node:path";
import holidayJp from "@holiday-jp/holiday_jp";
import { fetchYahooDaily, fetchUsTurnoverTop, formatChange, isStale } from "./lib/market-data.mjs";
import { US_STOCKS } from "../src/us-stocks-data.mjs";
import { writeArticle } from "./lib/article.mjs";

const mode = process.argv[2];
if (mode !== "morning" && mode !== "evening") {
  console.error("使い方: node scripts/generate.mjs <morning|evening>");
  process.exit(1);
}

// ---- 日本時間ユーティリティ ----------------------------------------------
const JST_OFFSET = 9 * 3600 * 1000;
function jstNow() {
  return new Date(Date.now() + JST_OFFSET); // UTCゲッターをJSTとして読む
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// now は +9h ずらした「JSTの壁時計」。暦日の算出・曜日/祝日判定にのみ使う。
// これを toISOString() で保存すると Z(UTC) 表記なのに中身がJSTになり二重加算になるため、
// pubDate には new Date()（真のUTC）を使うこと。
const now = jstNow();
const today = ymd(now);
const postsDir = path.resolve("content/posts");
fs.mkdirSync(postsDir, { recursive: true });

// 記事は削除せず蓄積する（SEO資産化のため、2026-07-25に7日自動削除を廃止）。
// 過去記事はトップの「アーカイブ」ページ（月別一覧）から辿れる。

const editionLabel = mode === "morning" ? "朝刊" : "夕刊";

// ---- 生成してよい時間帯（JST）の外なら何もしない --------------------------------
// GitHub の schedule(cron) は数時間遅れて発火することがあり、2026-09-29 には 9/28 の夕刊ジョブが
// 日付をまたいだ 0:01 に動いて「9/29 の夕刊はお休み」という誤ったお知らせを作った
// （残っていると当日の夕刊が生成済み扱いでスキップされる）。
// 遅れて動いたジョブが別の日付の記事を作らないよう、時間帯の外では何もせず終了する。
//   夕刊 … 15:00〜23:59（東証の大引け後〜当日中）
//   朝刊 … 6:00〜21:59（米国市場の引け後〜米国の取引開始前。取引時間中の途中データで書かない）
const WINDOWS = { morning: [6, 22], evening: [15, 24] };
const [fromHour, toHour] = WINDOWS[mode];
const hour = now.getUTCHours();
if ((hour < fromHour || hour >= toHour) && !process.argv.includes("--force")) {
  console.log(`${editionLabel}の生成時間帯（${fromHour}:00〜${toHour}:00 JST）の外のためスキップ: 現在 ${hour}時台`);
  process.exit(0);
}

const outPath = path.join(postsDir, `${today}-${mode}.md`);
if (fs.existsSync(outPath)) {
  // 二重発火（Cloud Scheduler と GitHub cron）時の上書き防止。既存があれば何もしない
  console.log(`既に生成済みのためスキップ: ${outPath}`);
  process.exit(0);
}

// 記事を出せない日は、代わりに理由を明記した「お知らせ」を同じ枠に投稿する。
// これにより記事が出ない日もサイトが更新され、理由がサイト上で分かる。
function postNotice(reason) {
  const title = `【お知らせ】${today} 本日の${editionLabel}はお休みです`;
  const description = `本日は${reason}のため、${editionLabel}の配信はありません。`;
  const body =
    `本日（${today}）は**${reason}**のため、${editionLabel}の市況記事はお休みです。\n\n` +
    `次回の配信をお待ちください。\n`;
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `pubDate: ${new Date().toISOString()}`, // 公開時刻は真のUTCで保存（表示側でJSTに変換）
    "edition: notice",
    "---",
    "",
  ].join("\n");
  fs.writeFileSync(outPath, frontmatter + body, "utf8");
  console.log(`お知らせを投稿しました（${reason}）: ${outPath}`);
  process.exit(0);
}

// ---- 市場が休みの日はお知らせを投稿 ---------------------------------------
if (mode === "evening") {
  // 東証: 土日・日本の祝日・年末年始(12/31-1/3)は休場
  const dow = now.getUTCDay();
  const md = today.slice(5);
  const isYearEnd = md === "12-31" || md === "01-01" || md === "01-02" || md === "01-03";
  if (dow === 0 || dow === 6 || isYearEnd || holidayJp.isHoliday(new Date(today))) {
    postNotice("東証休場");
  }
}

// ---- データ取得と記事生成 ---------------------------------------------------
function table(rows, headers) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

/** 四本値＋前日比を1行にまとめる（プロンプトに渡す市場データ用） */
function ohlc(q, closeLabel = "終値") {
  return `始値 ${q.open} / 高値 ${q.high} / 安値 ${q.low} / ${closeLabel} ${q.close} / 前日比 ${formatChange(q)}`;
}

// 冒頭の「今日のポイント」。どの日にも当てはまる一般論にならないよう、
// 具体的な数値と「次に何を確かめるか」まで書かせる（AdSense 審査の「有用性」対策、2026-09-29）。
const POINTS_SECTION = `## 今日のポイント（箇条書き3点。1点目＝最も大きな動きとその数値、2点目＝その背景・なぜ重要か、3点目＝次に確かめるとよい指標・イベント。各1〜2文）`;

async function main() {
  let title, description, body;

  if (mode === "morning") {
    const [ranking, spx, nasdaq, usdjpy, gold] = await Promise.all([
      fetchUsTurnoverTop(US_STOCKS, 5),
      fetchYahooDaily("^GSPC"),
      fetchYahooDaily("^IXIC"),
      fetchYahooDaily("USDJPY=X"),
      fetchYahooDaily("GC=F"),
    ]);

    if (isStale(spx.date)) {
      console.log(`米国市場のデータが古い: S&P500 ${spx.date}`);
      postNotice("米国市場が休場（データ未更新）の可能性");
    }

    // 売買代金ランキングは S&P 100 構成銘柄（大型株）が母集団。
    // 以前の「出来高TOP5」は1ドル未満の超低位株ばかりで読者の役に立たなかったため置き換えた。
    const rankingTable = table(
      ranking.top.map((r, i) => {
        const q = r.quote;
        const pct = q.changePercent == null ? "—" : `${q.changePercent > 0 ? "+" : ""}${q.changePercent.toFixed(2)}%`;
        return [
          String(i + 1),
          r.name.includes(r.ticker) ? r.name : `${r.name}（${r.ticker}）`,
          `$${q.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          pct,
          `約${Math.round(r.turnover / 1e8).toLocaleString("ja-JP")}億ドル`,
        ];
      }),
      ["順位", "銘柄", "株価", "騰落率", "売買代金"],
    );

    title = `【朝刊】${today} 米国市場まとめ｜売買代金TOP5・ドル円・金`;
    description = `${today}朝時点の米国株（S&P100）売買代金ランキング、S&P500・ナスダック、USD/JPY、金価格のまとめと今後の注目ニュース。`;
    body = await writeArticle(`本日は${today}（日本時間の朝）です。昨夜の米国市場の結果をまとめた「朝刊」記事を書いてください。

# 市場データ（この数値をそのまま使うこと）

## 米国株価指数（${spx.date}）
- S&P500：${ohlc(spx)}
- ナスダック総合：${ohlc(nasdaq)}

## 米国株 売買代金TOP5（S&P100構成銘柄、${ranking.date}）
${rankingTable}

## USD/JPY（${usdjpy.date}）
${ohlc(usdjpy, "直近")}

## 金先物（COMEX・ドル建て、${gold.date}）
${ohlc(gold)}

# 記事の構成
1. ${POINTS_SECTION}
2. ## 昨夜の米国市場サマリー（S&P500・ナスダックの前日比に触れて2〜3文）
3. ## 米国株 売買代金TOP5（上の表をそのまま載せ、各銘柄が売買を集めた背景を事実ベースで1〜2文ずつ。web検索で決算・ニュースを確認し、確認できなかったものは推測で書かない）
4. ## ドル円・金の値動き（前日比に触れた短い解説）
5. ## 今後の注目ニュース（web検索で本日〜明日の経済指標・イベント予定を確認し、加えて休場・連休や次回の中銀会合など直近で市場が意識している重要イベントが数日〜来週先にある場合はそれも含めてよい。2〜4件を「一般的に意識されやすい影響」の解説付きで。各項目の見出しには対象日を明記し、【重要度：高/中/低】を付けて重要度の高い順に並べる）`);
  } else {
    const [nikkei, usdjpy, gold] = await Promise.all([
      fetchYahooDaily("^N225"),
      fetchYahooDaily("USDJPY=X"),
      fetchYahooDaily("GC=F"),
    ]);

    if (nikkei.date !== today) {
      console.log(`日経平均の日付(${nikkei.date})が本日と一致しません（休場/未更新）`);
      postNotice("東証の相場データが未更新（休場の可能性）");
    }

    title = `【夕刊】${today} 東京市場まとめ｜日経平均・ドル円・金`;
    description = `${today}の東京株式市場の値動きまとめと今後の注目ニュース。`;
    body = await writeArticle(`本日は${today}（日本時間の夕方、東証の取引終了後）です。本日の東京市場をまとめた「夕刊」記事を書いてください。

# 市場データ（この数値をそのまま使うこと）

## 日経平均株価（${nikkei.date}）
${ohlc(nikkei)}

## USD/JPY（現在値、${usdjpy.date}）
${ohlc(usdjpy, "直近")}

## 金先物（COMEX・ドル建て、${gold.date}）
${ohlc(gold, "直近")}

# 記事の構成
1. ${POINTS_SECTION}
2. ## 本日の東京市場サマリー（2〜3文。web検索で本日の市況の背景を確認）
3. ## 日経平均の値動き（表＋解説。前日比に触れる）
4. ## ドル円・金の動き（前日比に触れた短い解説）
5. ## 今後の注目ニュース（web検索で今晩の米国の経済指標・イベントや明日の国内予定を確認し、加えて休場・連休や次回の中銀会合など直近で市場が意識している重要イベントが数日〜来週先にある場合はそれも含めてよい。2〜4件を「一般的に意識されやすい影響」の解説付きで。各項目の見出しには対象日を明記し、【重要度：高/中/低】を付けて重要度の高い順に並べる）`);
  }

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `pubDate: ${new Date().toISOString()}`, // 公開時刻は真のUTCで保存（表示側でJSTに変換）
    `edition: ${mode}`,
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(outPath, frontmatter + body + "\n", "utf8");
  console.log(`生成完了: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
