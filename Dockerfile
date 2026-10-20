FROM node:20-alpine

WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the rest of the source
COPY server ./server
COPY public ./public

# Actual port is chosen per-service in docker-compose.yml via CMD/env
EXPOSE 5000 5001 5002 5003 5004 5005 5006 5007

# Default command - overridden per service in docker-compose.yml
CMD ["node", "server/gateway.js"]
