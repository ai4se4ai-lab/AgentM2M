FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/schema/package.json packages/schema/package.json
COPY apps/engine/package.json apps/engine/package.json
RUN pnpm install --frozen-lockfile --filter @agentm2m/schema --filter @agentm2m/engine
COPY packages/schema packages/schema
COPY apps/engine apps/engine
COPY tsconfig.base.json tsconfig.base.json
RUN pnpm --filter @agentm2m/schema run build && pnpm --filter @agentm2m/engine run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/packages/schema /app/packages/schema
COPY --from=build /repo/apps/engine /app/apps/engine
WORKDIR /app/apps/engine
EXPOSE 4000
CMD ["node", "dist/main.js"]
