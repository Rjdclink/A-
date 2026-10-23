FROM node:22.16-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PUBLIC_DASHBOARD=true
ENV PUBLIC_WORKSPACE=default
ENV HOST=0.0.0.0
ENV DB_PATH=/data/a-plus.sqlite
ENV AUTOMATION_DB_PATH=/data/automation.sqlite
RUN mkdir -p /data
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
EXPOSE 3000
CMD ["node", "src/server.mjs"]
