FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/schema/package.json packages/schema/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN pnpm install --frozen-lockfile --filter @agentm2m/schema --filter @agentm2m/dashboard
COPY packages/schema packages/schema
COPY apps/dashboard apps/dashboard
COPY tsconfig.base.json tsconfig.base.json
RUN pnpm --filter @agentm2m/schema run build
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_ENGINE_PORT=4000
ARG NEXT_PUBLIC_BENCH_PORT=8000
ENV NEXT_PUBLIC_ENGINE_PORT=$NEXT_PUBLIC_ENGINE_PORT NEXT_PUBLIC_BENCH_PORT=$NEXT_PUBLIC_BENCH_PORT
RUN pnpm --filter @agentm2m/dashboard run build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/packages/schema /app/packages/schema
COPY --from=build /repo/apps/dashboard /app/apps/dashboard
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /app/
WORKDIR /app/apps/dashboard
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start"]
