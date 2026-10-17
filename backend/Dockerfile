FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY config ./config
COPY src ./src
COPY scripts/test-browser-source-access.ts scripts/test-google-search.ts ./scripts/
COPY scripts/docker ./scripts/docker
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=build /app/package.json /app/package-lock.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/config ./config
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/scripts ./scripts
COPY --chown=node:node certs ./certs
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
USER node
EXPOSE 3001
ENTRYPOINT ["scripts/docker/start.sh"]
CMD ["npm", "run", "start:api"]
