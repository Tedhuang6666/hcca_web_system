# ==============================================================================
# Stage 1: deps — 安裝 Node.js 依賴
# ==============================================================================
FROM node:24-alpine@sha256:fb71d01345f11b708a3553c66e7c74074f2d506400ea81973343d915cb64eef0 AS deps

WORKDIR /app

COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci --omit=dev

# ==============================================================================
# Stage 2: builder — 建置 Next.js 生產版本
# ==============================================================================
FROM node:24-alpine@sha256:fb71d01345f11b708a3553c66e7c74074f2d506400ea81973343d915cb64eef0 AS builder

WORKDIR /app

COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci

COPY apps/web/ .

# 建置時注入公開環境變數；API 空值代表使用同源 /api 代理
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_WS_URL=
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_BUILD_COMMIT=
ARG NEXT_PUBLIC_BUILD_REF=
ARG NEXT_PUBLIC_BUILD_TIME=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_BUILD_COMMIT=$NEXT_PUBLIC_BUILD_COMMIT
ENV NEXT_PUBLIC_BUILD_REF=$NEXT_PUBLIC_BUILD_REF
ENV NEXT_PUBLIC_BUILD_TIME=$NEXT_PUBLIC_BUILD_TIME

RUN npm run build

# ==============================================================================
# Stage 3: runtime — 最小化生產映像檔
# ==============================================================================
FROM node:24-alpine@sha256:fb71d01345f11b708a3553c66e7c74074f2d506400ea81973343d915cb64eef0 AS runtime

# Runtime only needs the Node.js binary. Upgrade Alpine security fixes and remove bundled npm.
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# 建立非 root 使用者
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

WORKDIR /app

# 複製建置產出
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000 \
    HOSTNAME="0.0.0.0" \
    NODE_ENV=production

CMD ["node", "server.js"]
