FROM node:20-alpine

WORKDIR /app

COPY server.js .

ENV LOG_DIR=/var/www/log-buffers
ENV PORT=4000

EXPOSE 4000

CMD ["node", "server.js"]
