import { defineConfig } from "astro/config";

// Firebase Hosting で公開する場合:
//   SITE_URL  = https://<FirebaseプロジェクトID>.web.app
//   BASE_PATH = /
// を GitHub Actions の env で渡す（README参照）。
export default defineConfig({
  site: process.env.SITE_URL || "https://example.com",
  base: process.env.BASE_PATH || "/",
});
