FROM node:22-alpine AS install
WORKDIR /app
COPY services/auth/package.json services/auth/package-lock.json ./
RUN npm ci --omit=dev
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=install --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node services/auth ./services/auth
COPY --chown=node:node services/billing/models/creditLedger.model.js ./services/billing/models/creditLedger.model.js
COPY --chown=node:node shared ./shared
WORKDIR /app/services/auth
USER node
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:8001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
