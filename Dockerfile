FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:4080/api/health || exit 1
CMD ["node", "--experimental-sqlite", "src/server.js"]
