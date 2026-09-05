# syntax=docker/dockerfile:1
# API-only image using the repository root lockfile:
#   fly deploy . --config server/fly.toml
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
EXPOSE 8080
CMD ["npm", "run", "start:api"]
