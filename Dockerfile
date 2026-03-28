FROM node:22-slim

# Install system dependencies for better-sqlite3 and Playwright
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    # Playwright Chromium dependencies
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first (for Docker layer caching)
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Install Playwright Chromium
RUN npx playwright install chromium

# Copy the rest of the source code
COPY . .

# Generate Drizzle migrations (if not already present)
RUN pnpm db:generate 2>/dev/null || true

# Create data directory
RUN mkdir -p .autodev/screenshots

# Expose port
EXPOSE 3000

# Default command: run in dev mode
CMD ["pnpm", "dev"]
