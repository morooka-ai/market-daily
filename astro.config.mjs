import { defineConfig } from "astro/config";

// 公開URL（SITE_URL）と配信パス（BASE_PATH）は
// GitHub Actions の env で渡す（README参照）。
export default defineConfig({
  site: process.env.SITE_URL || "https://example.com",
  base: process.env.BASE_PATH || "/",
});
