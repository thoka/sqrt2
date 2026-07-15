# Minimaler Relay-Service als eigenständiges Image.
FROM node:22-alpine

WORKDIR /app

# Nur Produktions-Deps installieren.
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

# Admin-Key + (spaeter) Token-DB leben hier (Compose-Mount).
VOLUME ["/data"]
ENV DATA_DIR=/data
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
