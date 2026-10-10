# ORIGEN — production image.
#
#   docker build -t origen .
#   docker run --rm -p 8080:8080 origen
#
# The app is a fully client-side Vite build, so the runtime stage only needs
# Node to run the dependency-free static server in server.js.

FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first so this layer is reused when only sources change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Runs the strict TypeScript gate before bundling, matching `npm run build`.
RUN npm run build


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

# server.js has no runtime dependencies, so only it and the build are needed.
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Never serve as root.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "server.js"]
