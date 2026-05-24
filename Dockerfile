FROM node:20-alpine

# Install dependencies untuk Baileys
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY src/ ./src/

# Buat folder sessions
RUN mkdir -p sessions

# Expose port (untuk health check Railway/Render)
EXPOSE 3000

# Jalankan bot
CMD ["node", "src/index.js"]
