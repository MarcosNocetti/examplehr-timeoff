FROM node:20-alpine AS base
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# Copy workspace metadata + lockfile (for cached install)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json .npmrc ./

# Copy contracts package (workspace dep) and timeoff-api app
COPY packages packages
COPY apps/timeoff-api apps/timeoff-api

# Install all workspace deps (also runs the contracts 'prepare' script that builds dist)
RUN pnpm install --frozen-lockfile

# Generate prisma client + build the api
WORKDIR /app/apps/timeoff-api
RUN pnpm prisma:generate
RUN pnpm build

# Expose api port
EXPOSE 3000

# Use a small entrypoint that runs migrations then picks api vs worker
COPY apps/timeoff-api/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
