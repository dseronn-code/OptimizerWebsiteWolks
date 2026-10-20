FROM node:22-alpine AS build
WORKDIR /app
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm --prefix server ci && npm --prefix web ci
COPY server server
COPY web web
RUN npm --prefix web run build && npm --prefix server run build && npm --prefix server prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3001
CMD ["node", "server/dist/server.js"]
