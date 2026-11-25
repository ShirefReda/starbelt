# Coolify — Unified Star Belt Quotations SPA + Fathy AI WhatsApp Agent
# Stage 1: Build the Vite frontend into dist/
# Stage 2: Run Node 22 server on port 8000 serving dist/ + /api/fathy/* + /api/evolution/*

FROM node:22-alpine AS build
WORKDIR /app

# Allow Coolify build-time environment injection for the Vite SPA
ARG EVOLUTION_BASE_URL
ARG STARBELT_API_KEY
ARG STARBELT_INSTANCE
ARG VITE_EVOLUTION_BASE_URL
ARG VITE_STARBELT_API_KEY
ARG VITE_STARBELT_INSTANCE
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8000

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/api/fathy/health || exit 1

CMD ["node", "server/index.mjs"]
