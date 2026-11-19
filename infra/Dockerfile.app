# Beauty Salon OS 应用镜像（API + Worker + 迁移共用）
# 构建上下文 = 仓库根目录
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/customer-web/package.json apps/customer-web/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/scheduler/package.json packages/scheduler/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @salon/api && npm run build -w @salon/worker

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/customer-web/package.json apps/customer-web/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/scheduler/package.json packages/scheduler/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --no-audit --no-fund
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
# 迁移与种子直接跑 TypeScript 源码（tsx 已包含在依赖中）
COPY packages packages
COPY apps/api/src apps/api/src
EXPOSE 8787
CMD ["node", "apps/api/dist/server.js"]
