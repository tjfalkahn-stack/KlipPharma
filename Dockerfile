FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3100
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg gosu python3 python3-pip \
    && python3 -m pip install --no-cache-dir --break-system-packages "yt-dlp[default]==2026.7.4" \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p storage/uploads storage/exports storage/projects && chown -R node:node storage
RUN chmod +x /app/docker-entrypoint.sh
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3100/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "start"]
