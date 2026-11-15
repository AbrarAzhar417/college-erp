# Builds the whole College ERP into one image (one server serves the API and the screens).
# Demo hosting:  docker build -t college-erp .   then   docker run -p 3000:3000 -e DEMO_SEED=1 -e JWT_SECRET=change-me college-erp
FROM node:22-bookworm AS build
WORKDIR /app
COPY backend/package*.json backend/
RUN cd backend && npm ci
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY backend backend
COPY frontend frontend
RUN cd frontend && npm run build && cd ../backend && npm run build

FROM node:22-bookworm-slim
WORKDIR /app/backend
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data WEB_ROOT=/app/frontend/dist/frontend/browser
COPY --from=build /app/backend/package*.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/assets ./assets
COPY --from=build /app/frontend/dist /app/frontend/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/boot.js"]
