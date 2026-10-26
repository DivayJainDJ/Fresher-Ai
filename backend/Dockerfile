FROM node:22-alpine AS install
WORKDIR /app
COPY services/billing/package.json services/billing/package-lock.json ./
RUN npm ci --omit=dev
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=install --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node services/billing ./services/billing
COPY --chown=node:node services/auth/model/user.model.js ./services/auth/model/user.model.js
COPY --chown=node:node services/billing/models ./services/billing/models
COPY --chown=node:node shared ./shared
WORKDIR /app/services/billing
USER node
EXPOSE 6005
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:6005/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
