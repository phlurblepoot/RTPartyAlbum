# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-slim AS build
WORKDIR /app

# Native build deps for better-sqlite3 / sharp during npm install
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install with full workspace context so npm workspaces resolve
COPY package.json package-lock.json* tsconfig.base.json ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm install

# Copy sources and build shared + server (web build is a placeholder in Plan 1)
COPY shared ./shared
COPY server ./server
COPY web ./web
RUN npm run build -w @rtpa/shared \
    && npm run build -w @rtpa/server \
    && npm run build -w @rtpa/web

# Prune dev dependencies for a lean runtime node_modules
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg installed for video processing in later plans
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
# The server's nanoid@5 is un-hoisted into server/node_modules: a dev-only transitive
# (@rtpa/web -> vite -> postcss -> nanoid@3) occupies the hoisted root slot, which
# `npm prune --omit=dev` then removes — leaving root with no nanoid. Copy the nested
# workspace node_modules so the server's production deps resolve at runtime (ESM).
COPY --from=build /app/server/node_modules ./server/node_modules
# Built SPA — the server (cwd=/app) serves /app/web/dist statically with an
# index.html SPA fallback (see server/src/app.ts; matches config.webDir default).
COPY --from=build /app/web/dist ./web/dist

VOLUME ["/data", "/uploads"]
EXPOSE 8080

CMD ["node", "server/dist/index.js"]
