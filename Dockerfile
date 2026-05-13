FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
# `npm ci` runs postinstall, which now calls scripts/prisma-generate-if-needed.cjs.
# Copy that helper before install so Docker builds do not fail on a missing file.
COPY scripts/prisma-generate-if-needed.cjs ./scripts/prisma-generate-if-needed.cjs
# The current lockfile contains a known peer-dependency mismatch in the
# Excalidraw adapter stack, so Docker must install from lock without trying to
# re-resolve peers under npm 10.
RUN npm ci --legacy-peer-deps
# Generate Prisma client after npm ci (reads prisma/schema.prisma).
RUN npx prisma generate

COPY . .
RUN npm run build && npm prune --omit=dev --legacy-peer-deps --ignore-scripts
# Re-generate Prisma client after prune (prune may remove it).
RUN npx prisma generate

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# These defaults match the bundled OCR runtime inside the container. Compose or
# `docker run -e ...` can override them when operators mount a custom OCR stack.
ENV NODE_ENV=production
ENV PORT=27015
ENV HOST=0.0.0.0
ENV HOME=/home/node
ENV OCR_PYTHON_BIN=/opt/ocr-venv/bin/python
ENV PADDLE_HOME=/app/.paddleocr
ENV PADDLE_PDX_MODEL_SOURCE=BOS
ENV PATH=/opt/ocr-venv/bin:${PATH}

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-pip python3-venv libglib2.0-0 libgl1 libgomp1 libsm6 libxext6 libxrender1 \
	&& python3 -m venv /opt/ocr-venv \
	&& /opt/ocr-venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
	&& /opt/ocr-venv/bin/pip install --no-cache-dir paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
	&& /opt/ocr-venv/bin/pip install --no-cache-dir paddleocr==3.2.0 \
	&& rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/uploads /app/.paddleocr /home/node/.paddlex && chown -R node:node /app /home/node

COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server.js ./server.js
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

USER node

# Preload the runtime OCR model cache during the image build so the first user
# upload does not trigger large downloads in production.
RUN "$OCR_PYTHON_BIN" /app/server/ocrRunner.py --self-check

EXPOSE 27015

# The server.js boot sequence automatically:
#   1. Creates the database if it does not exist.
#   2. Runs `prisma migrate deploy` (production) to apply committed migrations.
# No separate migration step is required — just start the server.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]