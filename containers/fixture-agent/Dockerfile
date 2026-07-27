FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY tools ./tools
RUN npm install --global pnpm@10.14.0 \
    && pnpm install --frozen-lockfile

USER 1000:1000
ENTRYPOINT ["node", "--import", "tsx", "/app/tools/harness/fixture-worker.ts"]
