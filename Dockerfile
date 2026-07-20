# Astro のビルド出力（dist/）を nginx で配信する軽量イメージ。
# ビルドは GitHub Actions 側で行い、ここでは静的ファイルを載せるだけ。
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html

# Cloud Run は PORT=8080 でリクエストを送ってくる
EXPOSE 8080
