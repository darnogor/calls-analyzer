FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/media/package.json apps/media/package.json
COPY apps/transcriber/package.json apps/transcriber/package.json
COPY apps/analyzer/package.json apps/analyzer/package.json
RUN npm ci
ARG SERVICE
COPY apps/${SERVICE} apps/${SERVICE}
RUN npm run build -w @calls/${SERVICE}

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/media/package.json apps/media/package.json
COPY apps/transcriber/package.json apps/transcriber/package.json
COPY apps/analyzer/package.json apps/analyzer/package.json
RUN npm ci --omit=dev
ARG SERVICE
ENV SERVICE=${SERVICE}
COPY --from=build /app/apps/${SERVICE}/dist apps/${SERVICE}/dist
COPY migrations /app/migrations
EXPOSE 3000
USER node
CMD ["sh", "-c", "node apps/$SERVICE/dist/main.js"]
