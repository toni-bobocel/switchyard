# Build from the repository root: docker build -f apps/gateway/Dockerfile .
FROM node:24-slim AS build
RUN npm install --global pnpm@12.23.0
WORKDIR /src
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @switchyard/gateway... \
 && pnpm --filter @switchyard/gateway... build \
 && pnpm --filter @switchyard/gateway deploy --prod --legacy /out \n && mkdir /ledger

FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
COPY --from=build /out .
# distroless has no shell to chown at runtime; the volume inherits this.
COPY --from=build --chown=65532:65532 /ledger /var/lib/switchyard
ENV NODE_ENV=production \
    SWITCHYARD_CONFIG=/etc/switchyard/switchyard.json \
    LEDGER_PATH=/var/lib/switchyard/ledger.db
VOLUME /var/lib/switchyard
EXPOSE 8080
CMD ["dist/server.js"]
