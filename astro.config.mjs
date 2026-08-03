import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// 公開URL（SITE_URL）と配信パス（BASE_PATH）は
// GitHub Actions の env で渡す（README参照）。
export default defineConfig({
  site: process.env.SITE_URL || "https://market-daily.jimulabo.com",
  base: process.env.BASE_PATH || "/",
  // 会員向けページ（/account/・/mail/）は検索結果に載せる必要がないので
  // サイトマップから除外する（各ページ側でも noindex を付けている）。
  integrations: [
    sitemap({
      filter: (page) => !/\/(account|mail)\//.test(page),
    }),
  ],
});
