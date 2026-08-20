# syntax=docker/dockerfile:1
# API only. Build context is THIS directory, so deploy from server/:
#   fly deploy
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=8080
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "index.mjs"]
