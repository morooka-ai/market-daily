// 週間まとめ記事の自動生成
// 使い方: node scripts/generate-weekly.mjs [--force]
//
// 朝刊ワークフローの中で毎回呼ばれ、土曜（JST）のときだけ記事を作る。
// 土曜の朝は金曜の米国市場が引けた後なので、月〜金の1週間がそろっている。
// --force を付けると曜日にかかわらず「直近の月〜金」で生成する（動作確認用）。
//
// 日々の朝刊・夕刊は同じ型の記事が続くため、1週間を通しての値動きと出来事を
// 長めにまとめた記事を週1本足して、サイトとしての独自の価値を出す（AdSense 審査対策、2026-09-29）。
//
// 数値（週間の始値・終値・高安・騰落率）はここで計算してプロンプトに渡し、
// Gemini には数値を創作させない。今週の朝刊・夕刊へのリンク一覧もここで機械的に付ける。

import fs from "node:fs";
import path from "node:path";
import { fetchYahooSeries } from "./lib/market-data.mjs";
import { writeArticle } from "./lib/article.mjs";

const force = process.argv.includes("--force");

const JST_OFFSET = 9 * 3600 * 1000;
const now = new Date(Date.now() + JST_OFFSET); // UTCゲッターをJSTとして読む
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

if (now.getUTCDay() !== 6 && !force) {
  console.log("週間まとめは土曜のみ生成します（スキップ）");
  process.exit(0);
}

// 対象週の月曜〜金曜。土曜なら前日が金曜、それ以外（--force）なら直近の金曜まで遡る。
const today = ymd(now);
const back = (now.getUTCDay() + 2) % 7 || 7; // 土=1, 日=2, 月=3 … 金=7（前週の金曜）
const friday = addDays(now, -back);
const monday = ymd(addDays(friday, -4));
const fri = ymd(friday);

const postsDir = path.resolve("content/posts");
const outPath = path.join(postsDir, `${today}-weekly.md`);
if (fs.existsSync(outPath)) {
  console.log(`既に生成済みのためスキップ: ${outPath}`);
  process.exit(0);
}

const INSTRUMENTS = [
  { symbol: "^N225", name: "日経平均株価", digits: 0 },
  { symbol: "^GSPC", name: "S&P500", digits: 2 },
  { symbol: "^IXIC", name: "ナスダック総合", digits: 2 },
  { symbol: "USDJPY=X", name: "USD/JPY", digits: 2 },
  { symbol: "GC=F", name: "金先物（ドル建て）", digits: 1 },
  { symbol: "BTC-JPY", name: "ビットコイン（円建て）", digits: 0 },
];

/** 対象週の値動きを集計する。前週末の終値を起点に、週末の終値までの騰落を出す */
async function weekly(inst) {
  const rows = await fetchYahooSeries(inst.symbol);
  const week = rows.filter((r) => r.date >= monday && r.date <= fri);
  const before = rows.filter((r) => r.date < monday);
  if (week.length === 0 || before.length === 0) return null;
  const start = before.at(-1).close;
  const end = week.at(-1).close;
  const f = (v) => v.toLocaleString("ja-JP", { minimumFractionDigits: inst.digits, maximumFractionDigits: inst.digits });
  const change = end - start;
  const pct = (change / start) * 100;
  const sign = change > 0 ? "+" : "";
  return {
    name: inst.name,
    cells: [
      inst.name,
      f(start),
      f(end),
      `${sign}${f(change)}（${sign}${pct.toFixed(2)}%）`,
      f(Math.max(...week.map((r) => r.high))),
      f(Math.min(...week.map((r) => r.low))),
    ],
    days: week.length,
  };
}

/**
 * 今週の朝刊・夕刊（お知らせを除く）の一覧と、冒頭の要約。
 * 夕刊は当日の東京市場（月〜金）、朝刊は前夜の米国市場を扱うので1日ずらして火〜土を対象にする。
 */
function weekPosts() {
  const files = fs.existsSync(postsDir) ? fs.readdirSync(postsDir) : [];
  const saturday = ymd(addDays(friday, 1));
  const tuesday = ymd(addDays(friday, -3));
  const inWeek = (f) => {
    const d = f.slice(0, 10);
    return f.includes("-evening") ? d >= monday && d <= fri : d >= tuesday && d <= saturday;
  };
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}-(morning|evening)\.md$/.test(f))
    .filter(inWeek)
    .sort()
    .map((f) => {
      const src = fs.readFileSync(path.join(postsDir, f), "utf8");
      if (/^edition:\s*notice\s*$/m.test(src)) return null;
      const title = JSON.parse(src.match(/^title:\s*(.+)$/m)?.[1] ?? '""');
      // 本文の最初の見出しセクション（今日のポイント or サマリー）を要約として渡す
      const bodyText = src.replace(/^---[\s\S]*?---\s*/, "");
      const firstSection = bodyText.split(/\n## /).slice(0, 2).join("\n## ").slice(0, 700);
      return { id: f.replace(/\.md$/, ""), title, summary: firstSection };
    })
    .filter(Boolean);
}

async function main() {
  const results = (await Promise.all(
    INSTRUMENTS.map((i) => weekly(i).catch((err) => (console.warn(`  取得失敗 ${i.name}: ${err.message}`), null))),
  )).filter(Boolean);
  if (results.length < 3) {
    console.log(`週間データが不足しているため生成しません（${results.length}件）`);
    return;
  }

  const line = (cells) => `| ${cells.join(" | ")} |`;
  const headers = ["銘柄", "前週末", "今週末", "週間騰落", "週間高値", "週間安値"];
  const weekTable = [line(headers), line(headers.map(() => "---")), ...results.map((r) => line(r.cells))].join("\n");

  const posts = weekPosts();
  const digest = posts.map((p) => `### ${p.title}\n${p.summary}`).join("\n\n");

  const range = `${md(monday)}〜${md(fri)}`;
  const body = await writeArticle(
    `本日は${today}（日本時間の朝）です。${monday}（月）〜${fri}（金）の1週間の市場を振り返る「週間まとめ」記事を書いてください。

# 週間の値動き（この表をそのまま記事に載せ、数値を変えないこと。休場日は集計に含まれない）
${weekTable}

# 今週の朝刊・夕刊の冒頭部分（出来事の把握に使う。文章をそのまま転記しない）
${digest || "（今週の記事はありません）"}

# 記事の構成
1. ## 今週のポイント（箇条書き3〜4点。上のルールの「今日のポイント」と同じく、今週に固有の数値と出来事で書く）
2. ## 今週の値動き一覧（上の表をそのまま載せ、2〜3文で全体像を説明）
3. ## 株式市場の1週間（日経平均と米国株。週の前半と後半で流れが変わった場合はそれを書く。web検索で主な材料を確認）
4. ## 為替・金・暗号資産の1週間（ドル円・金・ビットコイン）
5. ## 来週の注目ニュース（web検索で来週（${ymd(addDays(friday, 3))}〜${ymd(addDays(friday, 7))}）の経済指標・中銀会合・主要決算を確認し、3〜5件を「一般的に意識されやすい影響」の解説付きで。各項目の見出しには対象日を明記し、【重要度：高/中/低】を付けて重要度の高い順に並べる）`,
    { length: "2000〜3000字" },
  );

  const links = posts.length
    ? `\n\n## 今週の朝刊・夕刊\n\n${posts.map((p) => `- [${p.title}](/posts/${p.id}/)`).join("\n")}\n`
    : "\n";

  const title = `【週間まとめ】${range} 日経平均・米国株・ドル円・金の1週間`;
  const description = `${monday}〜${fri}の日経平均・S&P500・ナスダック・ドル円・金・ビットコインの週間騰落と主な出来事、来週の注目ニュース。`;
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `pubDate: ${new Date().toISOString()}`, // 公開時刻は真のUTCで保存（表示側でJSTに変換）
    "edition: weekly",
    "---",
    "",
  ].join("\n");

  fs.mkdirSync(postsDir, { recursive: true });
  fs.writeFileSync(outPath, frontmatter + body + links, "utf8");
  console.log(`生成完了: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
