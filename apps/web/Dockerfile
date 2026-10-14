# syntax=docker/dockerfile:1
# Built from the repo root: docker build -f apps/web/Dockerfile .
# The SPA behind nginx, which also proxies the API and the object store (apps/web/nginx.conf).
FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.5
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @dcm/web...

FROM deps AS build
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# Vite reads @dcm/contracts from source (the @dcm/source condition): no contracts build needed.
RUN pnpm --filter @dcm/web build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
