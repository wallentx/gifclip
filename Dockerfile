FROM node:latest

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg gifsicle \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node server.js ./
COPY --chown=node:node README.md ./

RUN mkdir -p /app/.gifclip /app/exports \
  && chown -R node:node /app

USER node

EXPOSE 8787

CMD ["node", "server.js"]
