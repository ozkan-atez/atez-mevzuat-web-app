# Workflow workspace (pnpm): tek imaj; servis rolü komutla seçilir (studio / worker / relay / scheduler / db:migrate).
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && chown -R node:node /app
ENV NODE_ENV=production HOST=0.0.0.0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
USER node
EXPOSE 3100
CMD ["pnpm", "studio"]
