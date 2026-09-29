# syntax=docker/dockerfile:1
# API-only image using the repository root lockfile (fly deploy from repo root).
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
RUN mkdir -p /app/server/data/private && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["npm", "run", "start:api"]
