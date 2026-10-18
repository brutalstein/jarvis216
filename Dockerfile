FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./
COPY packages/action-engine/package.json packages/action-engine/tsconfig.json ./packages/action-engine/
RUN npm ci --ignore-scripts
COPY src ./src
COPY packages/action-engine/src ./packages/action-engine/src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.22.0-bookworm-slim
ENV NODE_ENV=production JARVIS_CONTAINER=true
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# The workspace link in node_modules points here; only its package.json and build are needed.
COPY --from=build --chown=node:node /app/packages/action-engine/package.json ./packages/action-engine/
COPY --from=build --chown=node:node /app/packages/action-engine/dist ./packages/action-engine/dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 2160
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:2160/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
