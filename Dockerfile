# Opezee License Management System — API + dashboard in one image.
#   docker build -t opezee-lms .
#   docker run --env-file .env -p 5000:5000 opezee-lms

# ---- build: install everything, run tests, build the dashboard --------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm test && npm run build

# Drop dev dependencies (nodemon) before copying node_modules forward.
RUN npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "server/server.js"]
