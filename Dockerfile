FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production API_PORT=8787
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/server ./server
COPY --chown=node:node --from=build /app/contracts ./contracts
RUN mkdir -p /app/server/data/private && chown node:node /app/server/data/private
USER node
EXPOSE 8787
CMD ["npm", "start"]
