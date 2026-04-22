FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages packages
COPY apps/hcm-mock apps/hcm-mock

RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/hcm-mock
RUN pnpm build

EXPOSE 4000

CMD ["node", "dist/main.js"]
