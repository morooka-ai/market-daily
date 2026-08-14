import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { satteri } from "@astrojs/markdown-satteri";
import { isDetailIndexable } from "./src/chart-pairs.mjs";
import newsImportancePlugin from "./src/news-importance.mjs";

/**
 * 休場日の「お知らせ」記事のURLパス。
 * 数行しかない告知なので検索対象に含めない（記事ページ側でも noindex を付けている）。
 * astro:content はここから読めないため、Markdown を直接見て判定する。
 */
function noticePostPaths() {
  const dir = path.resolve("content/posts");
  const paths = new Set();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return paths;
  }
  for (const file of files) {
    const body = fs.readFileSync(path.join(dir, file), "utf8");
    if (/^edition:\s*notice\s*$/m.test(body)) {
      paths.add(`/posts/${file.replace(/\.md$/, "")}/`);
    }
  }
  return paths;
}

const NOTICE_PATHS = noticePostPaths();

// 公開URL（SITE_URL）と配信パス（BASE_PATH）は
// GitHub Actions の env で渡す（README参照）。
export default defineConfig({
  site: process.env.SITE_URL || "https://market-daily.jimulabo.com",
  base: process.env.BASE_PATH || "/",
  // 「注目ニュース」の各項目を重要度つきのカードに組み替える（src/news-importance.mjs）
  markdown: {
    processor: satteri({ hastPlugins: [newsImportancePlugin] }),
  },
  integrations: [
    sitemap({
      // サイトマップから外すもの（いずれもページ側で noindex も付けている）:
      //   - 会員向けページ（/account/・/mail/）
      //   - 会員の選択肢として追加した銘柄の詳細ページ（chart-pairs.mjs 参照）
      //   - 休場日の「お知らせ」記事
      filter: (page) => {
        const { pathname } = new URL(page);
        if (/\/(account|mail)\//.test(pathname)) return false;
        if (NOTICE_PATHS.has(pathname)) return false;
        const chart = pathname.match(/\/charts\/([^/]+)\//);
        return chart ? isDetailIndexable(chart[1]) : true;
      },
    }),
  ],
});
