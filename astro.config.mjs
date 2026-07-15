import { defineConfig } from "astro/config";

// GitHub Pages（プロジェクトサイト）で公開する場合:
//   SITE_URL  = https://<ユーザー名>.github.io
//   BASE_PATH = /<リポジトリ名>
// を GitHub Actions の env で渡す（README参照）。
export default defineConfig({
  site: process.env.SITE_URL || "https://example.com",
  base: process.env.BASE_PATH || "/",
});
