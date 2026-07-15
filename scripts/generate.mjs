// 記事の自動生成エントリポイント
// 使い方: node scripts/generate.mjs morning | evening

import fs from "node:fs";
import path from "node:path";
import holidayJp from "@holiday-jp/holiday_jp";
import { fetchYahooDaily, fetchUsMostActives, isStale } from "./lib/market-data.mjs";
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

const now = jstNow();
const today = ymd(now);
const postsDir = path.resolve("content/posts");
fs.mkdirSync(postsDir, { recursive: true });

const outPath = path.join(postsDir, `${today}-${mode}.md`);
if (fs.existsSync(outPath)) {
  console.log(`既に生成済みのためスキップ: ${outPath}`);
  process.exit(0);
}

// ---- 市場が休みの日はスキップ ---------------------------------------------
if (mode === "evening") {
  // 東証: 土日・日本の祝日・年末年始(12/31-1/3)は休場
  const dow = now.getUTCDay();
  const md = today.slice(5);
  const isYearEnd = md === "12-31" || md === "01-01" || md === "01-02" || md === "01-03";
  if (dow === 0 || dow === 6 || isYearEnd || holidayJp.isHoliday(new Date(today))) {
    console.log(`本日(${today})は東証休場のためスキップします`);
    process.exit(0);
  }
}

// ---- データ取得と記事生成 ---------------------------------------------------
function table(rows, headers) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

async function main() {
  let title, description, body;

  if (mode === "morning") {
    const apiKey = process.env.ALPHAVANTAGE_API_KEY;
    if (!apiKey) throw new Error("環境変数 ALPHAVANTAGE_API_KEY が未設定です");

    const [actives, usdjpy, gold] = await Promise.all([
      fetchUsMostActives(apiKey),
      fetchYahooDaily("USDJPY=X"),
      fetchYahooDaily("GC=F"),
    ]);

    if (isStale(actives.lastUpdated)) {
      console.log(`米国市場のデータが古い（休場の可能性）ためスキップします: ${actives.lastUpdated}`);
      process.exit(0);
    }

    const activesTable = table(
      actives.mostActives.map((r, i) => [
        String(i + 1), r.ticker, `$${r.price}`, r.changePercentage, Number(r.volume).toLocaleString(),
      ]),
      ["順位", "ティッカー", "株価", "騰落率", "出来高"],
    );

    title = `【朝刊】${today} 米国市場まとめ｜出来高TOP5・ドル円・金`;
    description = `${today}朝時点の米国株出来高ランキング、USD/JPY、金価格のまとめと本日の注目ニュース。`;
    body = await writeArticle(`本日は${today}（日本時間の朝）です。昨夜の米国市場の結果をまとめた「朝刊」記事を書いてください。

# 市場データ（この数値をそのまま使うこと）

## 米国株 出来高TOP5（データ更新: ${actives.lastUpdated}）
${activesTable}

## USD/JPY（NYクローズ、${usdjpy.date}）
始値 ${usdjpy.open} / 高値 ${usdjpy.high} / 安値 ${usdjpy.low} / 終値 ${usdjpy.close}

## 金先物（COMEX・ドル建て、${gold.date}）
始値 ${gold.open} / 高値 ${gold.high} / 安値 ${gold.low} / 終値 ${gold.close}

# 記事の構成
1. ## 昨夜の米国市場サマリー（2〜3文）
2. ## 米国株 出来高TOP5（表＋出来高上位になった背景を事実ベースで簡潔に。必要ならweb検索で確認）
3. ## ドル円・金の値動き（表または箇条書き＋短い解説）
4. ## 本日・今夜の注目ニュース（web検索で本日〜明日の経済指標・イベント予定を確認し、2〜4件を「一般的に意識されやすい影響」の解説付きで）`);
  } else {
    const [nikkei, usdjpy, gold] = await Promise.all([
      fetchYahooDaily("^N225"),
      fetchYahooDaily("USDJPY=X"),
      fetchYahooDaily("GC=F"),
    ]);

    if (nikkei.date !== today) {
      console.log(`日経平均の日付(${nikkei.date})が本日と一致しません（休場/未更新）。スキップします`);
      process.exit(0);
    }

    title = `【夕刊】${today} 東京市場まとめ｜日経平均・ドル円・金`;
    description = `${today}の東京株式市場の値動きまとめと、今晩から明日にかけての注目ニュース。`;
    body = await writeArticle(`本日は${today}（日本時間の夕方、東証の取引終了後）です。本日の東京市場をまとめた「夕刊」記事を書いてください。

# 市場データ（この数値をそのまま使うこと）

## 日経平均株価（${nikkei.date}）
始値 ${nikkei.open} / 高値 ${nikkei.high} / 安値 ${nikkei.low} / 終値 ${nikkei.close}

## USD/JPY（現在値、${usdjpy.date}）
始値 ${usdjpy.open} / 高値 ${usdjpy.high} / 安値 ${usdjpy.low} / 直近 ${usdjpy.close}

## 金先物（COMEX・ドル建て、${gold.date}）
始値 ${gold.open} / 高値 ${gold.high} / 安値 ${gold.low} / 直近 ${gold.close}

# 記事の構成
1. ## 本日の東京市場サマリー（2〜3文。必要ならweb検索で本日の市況の背景を確認）
2. ## 日経平均の値動き（表＋解説）
3. ## ドル円・金の動き（短い解説）
4. ## 今晩〜明日の注目ニュース（web検索で今晩の米国の経済指標・イベントや明日の国内予定を確認し、2〜4件を「一般的に意識されやすい影響」の解説付きで）`);
  }

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `pubDate: ${now.toISOString()}`,
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
