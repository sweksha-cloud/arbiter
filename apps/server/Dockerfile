# The Arbiter API server. Build from the repo root:
#   docker build -f apps/server/Dockerfile -t arbiter-server .

FROM node:26-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @arbiter/server...
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @arbiter/shared build && pnpm --filter @arbiter/server build
# A self-contained copy of the server with only its production dependencies
# (the shared package included as a real folder, not a workspace link).
RUN pnpm --filter @arbiter/server deploy --prod --legacy /out

FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# Migrations run on startup (src/db/migrate.ts reads ../../drizzle from dist/db).
COPY --from=build /out/drizzle ./drizzle
# The server only needs `node`. npm, npx, corepack and yarn ship with the base
# image and carry their own vulnerable dependencies (flagged by the Trivy scan
# in CI), so they are removed from the runtime image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
EXPOSE 4000
# 60 s to start: migrations wait on the database, which may be waking up (Neon).
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/index.js"]
