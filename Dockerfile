# Development image, also the base for the production build.
FROM node:25-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
CMD ["npm", "run", "dev"]

FROM dev AS build
RUN npm run build

# Production image. Keep this stage last so it stays the default build target.
FROM node:25-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
# A new volume takes this ownership, so the API can write uploads.
RUN mkdir uploads && chown node:node uploads
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
