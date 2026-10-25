FROM node:20-alpine AS install
WORKDIR /app
COPY services/interview/package.json services/interview/package-lock.json ./
RUN npm ci --omit=dev
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=install --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node services/interview ./services/interview
COPY --chown=node:node services/auth/model/user.model.js ./services/auth/model/user.model.js
COPY --chown=node:node services/billing/models/creditLedger.model.js ./services/billing/models/creditLedger.model.js
COPY --chown=node:node shared ./shared
WORKDIR /app/services/interview
USER node
EXPOSE 6003
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:6003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
