FROM node:20-slim

# Install dependencies minimal untuk Baileys
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files dulu (cache layer)
COPY package.json ./

# Install semua dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Buat folder sessions
RUN mkdir -p sessions

# Jalankan bot
CMD ["node", "src/index.js"]
