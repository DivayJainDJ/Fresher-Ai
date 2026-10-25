FROM node:22-alpine AS install
WORKDIR /app
COPY services/resume/package.json services/resume/package-lock.json ./
RUN npm ci --omit=dev
FROM node:22-alpine
ENV NODE_ENV=production
RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-eng
WORKDIR /app
COPY --from=install --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node services/resume ./services/resume
COPY --chown=node:node services/auth/model/user.model.js ./services/auth/model/user.model.js
COPY --chown=node:node services/billing/models/creditLedger.model.js ./services/billing/models/creditLedger.model.js
COPY --chown=node:node shared ./shared
WORKDIR /app/services/resume
USER node
EXPOSE 6002
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:6002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
