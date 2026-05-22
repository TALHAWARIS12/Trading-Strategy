# Multi-stage Dockerfile for production deployment on Render

# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDeps for TypeScript build)
RUN npm ci

# Copy source code
COPY src ./src
COPY public ./public

# Build TypeScript
RUN npm run build

# Stage 2: Runtime
FROM node:18-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy public assets
COPY --from=builder /app/public ./public

# Create necessary directories (data & logs persist via Render Disk or ephemeral)
RUN mkdir -p ./data ./logs

# Expose port (Render sets PORT env var automatically)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start application
CMD ["node", "dist/app.js"]
