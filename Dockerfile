# Produktions-Image fuer das Exponat (Frontend + embedded Relay in einem).
# Baut die Svelte-Statics nach dist/ und startet den Exponat-Server
# (server/index.js: Statics + Relay unter einem Origin).
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY server ./server

# Admin-Key + (spaeter) Token-DB leben hier (Compose-Mount).
VOLUME ["/data"]
ENV DATA_DIR=/data
ENV PORT=8080

EXPOSE 8080
CMD ["node", "server/index.js"]
