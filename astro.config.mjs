import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// 公開URL（SITE_URL）と配信パス（BASE_PATH）は
// GitHub Actions の env で渡す（README参照）。
export default defineConfig({
  site: process.env.SITE_URL || "https://market-daily.jimulabo.com",
  base: process.env.BASE_PATH || "/",
  integrations: [sitemap()],
});
