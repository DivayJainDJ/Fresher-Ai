FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY backend/gateway/package.json ./backend/gateway/package.json
COPY backend/services/auth/package.json ./backend/services/auth/package.json
COPY backend/services/billing/package.json ./backend/services/billing/package.json
COPY backend/services/interview/package.json ./backend/services/interview/package.json
COPY backend/services/resume/package.json ./backend/services/resume/package.json
COPY backend/services/roadmap/package.json ./backend/services/roadmap/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root=false
COPY frontend ./frontend
ARG VITE_BACKEND_URL=http://localhost:8000
ARG VITE_RAZORPAY_KEY_ID=
ARG VITE_FIREBASE_APIKEY=
ARG VITE_FIREBASE_AUTHDOMAIN=
ARG VITE_FIREBASE_PROJECTID=
ARG VITE_FIREBASE_STORAGEBUCKET=
ARG VITE_FIREBASE_MESSAGINGSENDERID=
ARG VITE_FIREBASE_APPID=
ARG VITE_FIREBASE_MEASUREMENTID=
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL VITE_RAZORPAY_KEY_ID=$VITE_RAZORPAY_KEY_ID VITE_FIREBASE_APIKEY=$VITE_FIREBASE_APIKEY VITE_FIREBASE_AUTHDOMAIN=$VITE_FIREBASE_AUTHDOMAIN VITE_FIREBASE_PROJECTID=$VITE_FIREBASE_PROJECTID VITE_FIREBASE_STORAGEBUCKET=$VITE_FIREBASE_STORAGEBUCKET VITE_FIREBASE_MESSAGINGSENDERID=$VITE_FIREBASE_MESSAGINGSENDERID VITE_FIREBASE_APPID=$VITE_FIREBASE_APPID VITE_FIREBASE_MEASUREMENTID=$VITE_FIREBASE_MEASUREMENTID
RUN node node_modules/vite/bin/vite.js build frontend

FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
