# Runtime image for a generated AGNTDEV bot. BOT_TOKEN is injected at RUNTIME as
# a secret — never baked into an image layer.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Drop dev deps in place.
RUN npm prune --omit=dev

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
