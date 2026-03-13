FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
# Generate Prisma client after npm ci (reads prisma/schema.prisma).
RUN npx prisma generate

COPY . .
RUN npm run build && npm prune --omit=dev
# Re-generate Prisma client after prune (prune may remove it).
RUN npx prisma generate

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=27015
ENV HOST=0.0.0.0

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-pip libglib2.0-0 libgl1 libgomp1 \
	&& python3 -m pip install --no-cache-dir paddleocr paddlepaddle \
	&& rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/uploads && chown -R node:node /app

COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server.js ./server.js
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

USER node

EXPOSE 27015

# The server.js boot sequence automatically:
#   1. Creates the database if it does not exist.
#   2. Runs `prisma migrate deploy` (production) to apply committed migrations.
# No separate migration step is required — just start the server.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]