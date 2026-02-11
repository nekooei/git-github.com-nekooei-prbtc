FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@8.15.0

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/logger/package.json ./packages/logger/
COPY packages/config/package.json ./packages/config/
COPY packages/metrics/package.json ./packages/metrics/
COPY packages/proxy-core/package.json ./packages/proxy-core/
COPY packages/proxy-service/package.json ./packages/proxy-service/
COPY packages/miner-sim/package.json ./packages/miner-sim/
COPY packages/integration-tests/package.json ./packages/integration-tests/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages ./packages

# Build packages in dependency order
RUN pnpm --filter @mining-proxy/shared-types build
RUN pnpm --filter @mining-proxy/logger build
RUN pnpm --filter @mining-proxy/config build
RUN pnpm --filter @mining-proxy/metrics build
RUN pnpm --filter @mining-proxy/proxy-core build
RUN pnpm --filter @mining-proxy/miner-sim build
RUN pnpm --filter @mining-proxy/proxy-service build

# Production image
FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm@8.15.0

# Copy built artifacts and dependencies
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

ENV NODE_ENV=production

EXPOSE 3333 9090

CMD ["pnpm", "start"]
