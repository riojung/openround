FROM node:22-alpine

ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate && chmod -R a+rX /opt/corepack
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/experience/package.json packages/experience/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
RUN pnpm install --frozen-lockfile

COPY tests/load tests/load
COPY tests/support/report-readiness.ts tests/support/report-readiness.ts

USER node
CMD ["pnpm", "load:compose:aggregate"]
