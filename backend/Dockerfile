# Multi-stage production build for WebMirror Browser-Processing Service
FROM mcr.microsoft.com/playwright:v1.49.0-focal AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Production Runner
FROM mcr.microsoft.com/playwright:v1.49.0-focal AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create storage directory for workspaces and persisted jobs
RUN mkdir -p /app/storage/workspaces && chmod -R 777 /app/storage

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
