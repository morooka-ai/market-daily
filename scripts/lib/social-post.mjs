// 朝刊・夕刊のSNS告知文を組み立てる共通モジュール。
// post-to-x.mjs / post-to-bluesky.mjs から使う。
//
// 方針:
//  - 当日(JST)の content/posts/YYYY-MM-DD-<mode>.md を読み、frontmatter と本文から
//    見出し・主要数値（ドル円の終値、朝は出来高首位銘柄、夕は日経平均終値）を拾う。
//  - edition: notice（お知らせ記事）と記事欠落は告知しない（skip を返す）。
//  - リンクには UTM を付ける（GA4 で流入元を判別するため）。
//  - X は本文にURLを含める（リンクカードはOGPクロールで付く）。
//    Bluesky はURLを本文に入れず、embed.external でカードを持たせる。
import fs from "node:fs";
import path from "node:path";

export const SITE_URL = "https://market-daily.jimulabo.com";

const HASHTAGS = {
  morning: ["米国株", "ドル円", "株クラ"],
  evening: ["日経平均", "日本株", "株クラ"],
};
const CAMPAIGN = { morning: "asakan", evening: "yukan" };

export function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function readArticle(mode, date) {
  const slug = `${date}-${mode}`;
  const file = path.resolve("content/posts", `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  return {
    slug,
    src,
    title: src.match(/^title:\s*"(.+)"\s*$/m)?.[1],
    description: src.match(/^description:\s*"(.+)"\s*$/m)?.[1] ?? "",
    edition: src.match(/^edition:\s*(\w+)\s*$/m)?.[1],
  };
}

// 見出し headingRe 以降から「終値/直近値」を1つ拾う。
// 縦型（| 終値 | 123 |）と横型（| 始値 | 高値 | 安値 | 終値 | の次行）の両方に対応。
function pickClose(body, headingRe) {
  const start = body.search(headingRe);
  if (start < 0) return null;
  const section = body.slice(start, start + 1400);

  const vertical = section.match(
    /\|\s*(?:終値|直近値)\s*\|\s*[$￥]?\s*([\d,]+(?:\.\d+)?)\s*\|/,
  );
  if (vertical) return vertical[1];

  const rows = section.split("\n").filter((l) => l.trim().startsWith("|"));
  for (let i = 0; i < rows.length - 2; i++) {
    const head = rows[i].split("|").map((c) => c.trim());
    const idx = head.findIndex((c) => c === "終値" || c === "直近値");
    if (idx < 0) continue;
    const cell = rows[i + 2] // i+1 は区切り行
      ?.split("|")
      .map((c) => c.trim())[idx]
      ?.replace(/[$￥,]/g, "");
    if (cell && /^\d/.test(cell)) return cell.replace(/(\d)(?=(\d{3})+(?:\.|$))/g, "$1,");
  }
  return null;
}

// 「米国株 出来高TOP5」表の1位: ティッカーと騰落率
function pickTopStock(body) {
  const m = body.match(
    /\|\s*1\s*\|\s*([A-Z][A-Z.]*)\s*\|\s*\$?[\d,]+(?:\.\d+)?\s*\|\s*(-?\d+(?:\.\d+)?)\s*%/,
  );
  if (!m) return null;
  const pct = Number(m[2]);
  return `${m[1]} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

// mode: "morning" | "evening"
// opts.platform: "x" | "bluesky"（UTM の source と本文の作り方に影響）
// opts.date: "YYYY-MM-DD"（省略時は JST 今日。ローカルテスト用）
export function buildPost(mode, { platform = "x", date = jstToday() } = {}) {
  if (!["morning", "evening"].includes(mode)) {
    return { skip: `不正な mode: ${mode}` };
  }
  const art = readArticle(mode, date);
  if (!art) return { skip: `記事がありません: ${date}-${mode}` };
  if (!art.title) return { skip: "frontmatter から title を取得できません" };
  if (art.edition === "notice") return { skip: "お知らせ記事のため告知しない" };

  const url = `${SITE_URL}/posts/${art.slug}/?utm_source=${platform}&utm_medium=social&utm_campaign=${CAMPAIGN[mode]}`;

  // 見出し = タイトルから日付を除いたもの
  const hook = art.title
    .replace(/\s*\d{4}-\d{2}-\d{2}\s*/, " ")
    .replace(/】\s+/, "】")
    .replace(/\s+/g, " ")
    .trim();

  const rate = pickClose(art.src, /^#+ .*(?:USD\/JPY|外国為替|ドル円)/m);
  const lines = [];
  if (mode === "morning") {
    if (rate) lines.push(`▼ドル円 ${rate}`);
    const top = pickTopStock(art.src);
    if (top) lines.push(`▼${top}（出来高首位）`);
  } else {
    const nikkei = pickClose(art.src, /^#+ .*日経平均/m);
    if (nikkei) lines.push(`▼日経平均 ${nikkei}`);
    if (rate) lines.push(`▼ドル円 ${rate}`);
  }

  return {
    skip: null,
    slug: art.slug,
    url,
    hook,
    lines,
    tags: HASHTAGS[mode].map((t) => `#${t}`),
    ogTitle: art.title,
    ogDescription: art.description,
  };
}

// X 用の本文（URL を含む）。280字（URLは23文字換算）に収まるよう hook を詰める。
export function composeX(post) {
  const body = post.lines.length ? `\n\n${post.lines.join("\n")}` : "";
  const tagline = `\n\n${post.tags.join(" ")}`;
  const weight = (s) => [...s.replace(post.url, "x".repeat(23))].length;
  let hook = post.hook;
  let text = `${hook}${body}\n\n${post.url}${tagline}`;
  while (weight(text) > 280 && hook.length > 12) {
    hook = `${hook.slice(0, -2)}…`;
    text = `${hook}${body}\n\n${post.url}${tagline}`;
  }
  return text;
}

// Bluesky 用の本文（URL は embed.external が持つので含めない）。300 graphemes 上限。
export function composeBluesky(post) {
  const body = post.lines.length ? `\n\n${post.lines.join("\n")}` : "";
  const tagline = `\n\n${post.tags.join(" ")}`;
  let hook = post.hook;
  let text = `${hook}${body}${tagline}`;
  while ([...text].length > 300 && hook.length > 12) {
    hook = `${hook.slice(0, -2)}…`;
    text = `${hook}${body}${tagline}`;
  }
  return text;
}
