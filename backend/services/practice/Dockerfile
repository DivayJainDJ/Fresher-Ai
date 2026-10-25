FROM node:22-alpine AS install
WORKDIR /app
COPY services/practice/package.json services/practice/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=install --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node services/practice ./services/practice
COPY --chown=node:node services/auth/model/user.model.js ./services/auth/model/user.model.js
COPY --chown=node:node shared ./shared
WORKDIR /app/services/practice
USER node
EXPOSE 6007
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:6007/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
