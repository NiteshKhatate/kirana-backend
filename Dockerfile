# syntax=docker/dockerfile:1
# Preserve the repository's Node 20 major. Pin an approved digest for releases.
ARG NODE_IMAGE=node:20-bookworm-slim
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts ./
# Generation does not connect to this deliberately unusable build-only target.
RUN DATABASE_URL=postgresql://build:unused@127.0.0.1:5432/kirana_identity npx --no-install prisma generate

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build
COPY ops ./ops
ARG BUILD_SHA=unknown
RUN node ops/build-info.cjs "$BUILD_SHA"

FROM build AS migration
# Explicit, separately approved release job only; never the application startup.
USER node
ENTRYPOINT ["node", "ops/migrate.cjs"]

FROM build AS production-dependencies
# npm can retain Prisma CLI through Client's optional peer relationship.
# Generated Client and its native query engine remain in node_modules/.prisma.
RUN npm prune --omit=dev --no-audit --no-fund && rm -rf node_modules/prisma

FROM base AS runtime
ENV NODE_ENV=production PORT=3001
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/ops ./ops
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "ops/healthcheck.cjs"]
CMD ["node", "dist/src/main.js"]
