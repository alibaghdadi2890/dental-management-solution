# syntax=docker/dockerfile:1
# Built from the repo root: docker build -f apps/api/Dockerfile .
# The API: @dcm/contracts and the NestJS app compiled, production dependencies only. Nothing from
# the environment is baked in; the box's /opt/dcm/.env and compose file supply it (infra/compose).
FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.5
WORKDIR /app

# Every workspace manifest, even the packages this image does not build: pnpm resolves the whole
# workspace before applying --filter, and a missing manifest reads as a stale lockfile.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/

FROM manifests AS deps
RUN pnpm install --frozen-lockfile --filter @dcm/api...

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @dcm/api...

FROM deps AS build
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/api apps/api
# The API requires @dcm/contracts from its dist (the default export condition), so contracts first.
RUN pnpm --filter @dcm/contracts build && pnpm --filter @dcm/api build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
# dist/cli/migrate.js applies these at deploy time (infra/scripts/ship.sh up).
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
