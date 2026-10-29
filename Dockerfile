# syntax=docker/dockerfile:1

# ---- build the web app ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY web web
RUN npm run build -w web

# ---- server runtime dependencies only ----
FROM node:24-alpine AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Node server (TypeScript runs directly, no build step) ----
FROM node:24-alpine AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-deps /app /app
COPY server/src server/src
RUN mkdir /data && chown node:node /data
USER node
WORKDIR /app/server
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3210/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]

# ---- nginx: app files and proxy to the server (HTTPS is done by the host's nginx) ----
FROM nginx:stable-alpine AS web
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/web/dist /usr/share/nginx/html
