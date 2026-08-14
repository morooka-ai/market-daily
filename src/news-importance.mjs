/**
 * 記事の「注目ニュース」を、重要度つきのカードに組み替える Markdown プラグイン。
 * Astro 既定の Markdown 処理系（Sätteri）の hast プラグインとして動く。
 *
 * Markdown 側は今まで通り ### 見出し＋本文で書ける。ここでは
 *   ## 〜注目ニュース
 *   ### 1. 【重要度：高】米国 7月CPI（8月12日 21:30）
 * という並びを見つけ、### ごとに <section class="news-item …"> でくくって
 * 重要度バッジを添える。色や枠の指定は Base.astro の全体スタイル側にある。
 *
 * 【重要度：〜】が無い過去記事（2026-08-11以前）のために、見出しの語句からの
 * 推定も持たせている。推定は表示上の強弱づけだけで、本文には手を入れない。
 */

/** 見出しに書かれた重要度マーク。全角・半角のカッコとコロンを許容する */
const MARK_RE = /[【[]\s*重要度\s*[：:]\s*(高|中|低)\s*[\]】]\s*/;

/**
 * 相場全体が動きやすい指標・イベント（推定用）。
 * 政策金利は主要中銀のものだけを「高」とし、それ以外（豪州・NZなど）は
 * 既定の「中」に落とす。特定の通貨に影響が寄りやすいため。
 */
const HIGH_PATTERNS = [
  /FOMC/i,
  /連邦公開市場委員会/,
  /(FRB|FOMC|米連邦準備|日銀|日本銀行|ECB|欧州中央銀行|BOE|イングランド銀行)[^。]{0,12}(政策金利|金融政策|会合)/,
  /金融政策決定会合/,
  /消費者物価/,
  /\bCPI\b/i,
  /生産者物価|\bPPI\b/i,
  /雇用統計/,
  /非農業部門/,
  /\bPCE\b/i,
  /\bGDP\b/,
  /国内総生産/,
  /(議長|総裁)[^。]{0,8}(発言|講演|会見|証言)/,
  /ジャクソンホール/,
];

/** 参考程度に押さえておけばよいもの（推定用） */
const LOW_PATTERNS = [/休場/, /祝日/, /振替休日/];

const LEVELS = {
  高: { className: "news-item--high", dots: "●●●", label: "高" },
  中: { className: "news-item--mid", dots: "●●○", label: "中" },
  低: { className: "news-item--low", dots: "●○○", label: "低" },
};

const isElement = (node, tagName) =>
  node?.type === "element" && node.tagName === tagName;

function textOf(node) {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/**
 * 可変の素の hast ノードに複製する。visit に渡ってくるノードは読み取り専用なので、
 * 作り直したカードの中身として使うにはこの複製を通す。
 */
function clone(node) {
  const copy = { type: node.type };
  if (node.tagName) copy.tagName = node.tagName;
  if (node.value !== undefined) copy.value = node.value;
  if (node.properties) copy.properties = structuredClone(node.properties);
  if (node.children) copy.children = node.children.map(clone);
  return copy;
}

/** 複製した見出しから【重要度：〜】を取り除き、その値を返す（無ければ null） */
function takeMark(node) {
  let level = null;
  const walk = (n) => {
    if (level) return;
    if (n.type === "text") {
      const m = n.value.match(MARK_RE);
      if (m) {
        level = m[1];
        n.value = n.value.replace(MARK_RE, "");
      }
      return;
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return level;
}

/** マークが無い記事向けの推定。判断がつかないものは「中」に寄せる */
function guessLevel(text) {
  if (HIGH_PATTERNS.some((re) => re.test(text))) return "高";
  if (LOW_PATTERNS.some((re) => re.test(text))) return "低";
  return "中";
}

const el = (tagName, className, children) => ({
  type: "element",
  tagName,
  properties: { className },
  children,
});

const text = (value) => ({ type: "text", value });

function badge(level) {
  const { dots, label } = LEVELS[level];
  return el("p", ["news-badge"], [
    {
      type: "element",
      tagName: "span",
      properties: { className: ["news-dots"], "aria-hidden": "true" },
      children: [text(dots)],
    },
    text(`重要度 ${label}`),
  ]);
}

function legend() {
  return el("p", ["news-legend"], [
    text("重要度の目安："),
    el("span", ["news-legend-item", "lv-high"], [text("●●● 相場全体")]),
    el("span", ["news-legend-item", "lv-mid"], [text("●●○ 一部の市場")]),
    el("span", ["news-legend-item", "lv-low"], [text("●○○ 参考")]),
  ]);
}

const isNewsHeading = (node) =>
  isElement(node, "h2") && textOf(node).includes("注目ニュース");

/** その見出しが「注目ニュース」セクションの中にあるか（直前の ## を見る） */
function inNewsSection(node, ctx) {
  const parent = ctx.parent(node);
  const index = ctx.indexOf(node);
  if (!parent?.children || index === undefined) return null;
  for (let i = index - 1; i >= 0; i--) {
    const sibling = parent.children[i];
    if (isElement(sibling, "h2")) return isNewsHeading(sibling) ? parent : null;
  }
  return null;
}

export default function newsImportancePlugin() {
  return {
    name: "news-importance",
    element: [
      {
        // 見出しの直後に重要度の凡例を置く
        filter: ["h2"],
        visit(node, ctx) {
          if (isNewsHeading(node)) ctx.insertAfter(node, legend());
        },
      },
      {
        // 各項目を見出しから次の見出しの手前までまとめてカードにする
        filter: ["h3"],
        visit(node, ctx) {
          const parent = inNewsSection(node, ctx);
          if (!parent) return;

          const heading = clone(node);
          const level = takeMark(heading) ?? guessLevel(textOf(heading));
          const body = [];
          for (let i = ctx.indexOf(node) + 1; i < parent.children.length; i++) {
            const sibling = parent.children[i];
            if (isElement(sibling, "h2") || isElement(sibling, "h3")) break;
            body.push(sibling);
          }
          for (const sibling of body) ctx.removeNode(sibling);

          return el(
            "section",
            ["news-item", LEVELS[level].className],
            [badge(level), heading, ...body.map(clone)],
          );
        },
      },
    ],
  };
}
