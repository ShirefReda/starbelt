# Coolify — static build + nginx
# Build the Vite app, then serve dist/ with nginx + SPA fallback

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:stable-alpine AS runtime
# SPA fallback: all 404s -> index.html (so PWA routes work)
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf 'server {\n\
  listen 8000;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  gzip on;\n\
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml font/woff2;\n\
  gzip_min_length 256;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
  location ~* \\.(?:css|js|woff2|png|svg|webmanifest)$ {\n\
    expires 1y;\n\
    add_header Cache-Control "public, immutable";\n\
  }\n\
  location = /sw.js {\n\
    add_header Cache-Control "no-cache";\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 8000
