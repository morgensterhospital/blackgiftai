# BLACKGIFT AI Dockerfile
FROM node:20-alpine

WORKDIR /usr/src/app

# Install dependencies (production)
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy app
COPY . .

# Expose port
EXPOSE 3000

CMD ["node", "server.js"]