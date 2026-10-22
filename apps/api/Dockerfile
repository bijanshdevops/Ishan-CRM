# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/i18n/package.json packages/i18n/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @ishan/api...
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/i18n packages/i18n
COPY apps/api apps/api
RUN pnpm --filter @ishan/contracts build && pnpm --filter @ishan/i18n build && pnpm --filter @ishan/api build

FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM base AS runner
# Headless Chromium renders quote PDFs (ADR 0016); the font package gives it Arabic-script shaping.
RUN apk add --no-cache chromium font-noto-arabic
ENV NODE_ENV=production \
    PDF_CHROMIUM_PATH=/usr/bin/chromium
COPY --from=build /repo /repo
# Only runtime dependencies ship: drop the dev/test toolchain (smaller image, fewer CVEs) and npm itself,
# which the container never calls (corepack/pnpm stay for the build stages only).
RUN CI=true pnpm install --prod --frozen-lockfile --filter @ishan/api... \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health/live || exit 1
CMD ["node", "dist/main.js"]
