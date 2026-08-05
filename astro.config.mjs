import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { isDetailIndexable } from "./src/chart-pairs.mjs";

// 公開URL（SITE_URL）と配信パス（BASE_PATH）は
// GitHub Actions の env で渡す（README参照）。
export default defineConfig({
  site: process.env.SITE_URL || "https://market-daily.jimulabo.com",
  base: process.env.BASE_PATH || "/",
  integrations: [
    sitemap({
      // サイトマップから外すもの（いずれもページ側で noindex も付けている）:
      //   - 会員向けページ（/account/・/mail/）
      //   - 会員の選択肢として追加した銘柄の詳細ページ（chart-pairs.mjs 参照）
      filter: (page) => {
        if (/\/(account|mail)\//.test(page)) return false;
        const chart = page.match(/\/charts\/([^/]+)\//);
        return chart ? isDetailIndexable(chart[1]) : true;
      },
    }),
  ],
});
