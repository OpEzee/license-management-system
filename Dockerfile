# Opezee License Management System — API + dashboard in one image.
#   docker build -t opezee-lms .
#   docker run --env-file .env -p 5000:5000 opezee-lms
#
# The server exits at start-up if it cannot reach MongoDB, and 127.0.0.1 inside
# the container is the container itself. Point MONGODB_URI somewhere it can reach:
#
#   # MongoDB running on the Docker host (Docker Desktop on Windows/macOS)
#   docker run --env-file .env -p 5000:5000 \
#     -e MONGODB_URI=mongodb://host.docker.internal:27017 opezee-lms
#
#   # A hosted database such as MongoDB Atlas
#   docker run --env-file .env -p 5000:5000 \
#     -e "MONGODB_URI=mongodb+srv://user:password@cluster0.example.mongodb.net/" \
#     -e MONGODB_DB=opezee_licenses opezee-lms
#
#   # Backups land in /app/backups; mount it so they outlive the container
#   docker run --rm --env-file .env -v ./backups:/app/backups opezee-lms npm run backup-db

# ---- build: install everything, build the dashboard -------------------------
# The tests are not run here: they need a live MongoDB, which a build step
# cannot reach. Run `npm test` before building the image.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

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

# `npm run backup-db` writes here, and /app itself is root-owned.
RUN mkdir -p /app/backups && chown node:node /app/backups

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "server/server.js"]
