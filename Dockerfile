FROM node:20-alpine AS build
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

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=27015
ENV HOST=0.0.0.0

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/server ./server
COPY --from=build /app/prisma ./prisma

EXPOSE 27015

# The server.js boot sequence automatically creates the database (if needed)
# and syncs the Prisma schema on every startup. No separate migration step
# is required — just start the server.
CMD ["node", "server.js"]