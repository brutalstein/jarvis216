FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./
COPY packages/action-engine/package.json packages/action-engine/tsconfig.json ./packages/action-engine/
COPY packages/integration-hub/package.json packages/integration-hub/tsconfig.json ./packages/integration-hub/
COPY packages/brain/package.json packages/brain/tsconfig.json ./packages/brain/
RUN npm ci --ignore-scripts
COPY src ./src
COPY packages/action-engine/src ./packages/action-engine/src
COPY packages/integration-hub/src ./packages/integration-hub/src
COPY packages/brain/src ./packages/brain/src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.22.0-bookworm-slim
ENV NODE_ENV=production JARVIS_CONTAINER=true
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# The workspace links in node_modules point here; only its package.json and build are needed.
COPY --from=build --chown=node:node /app/packages/action-engine/package.json ./packages/action-engine/
COPY --from=build --chown=node:node /app/packages/action-engine/dist ./packages/action-engine/dist
COPY --from=build --chown=node:node /app/packages/integration-hub/package.json ./packages/integration-hub/
COPY --from=build --chown=node:node /app/packages/integration-hub/dist ./packages/integration-hub/dist
COPY --from=build --chown=node:node /app/packages/brain/package.json ./packages/brain/
COPY --from=build --chown=node:node /app/packages/brain/dist ./packages/brain/dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 2160
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:2160/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
