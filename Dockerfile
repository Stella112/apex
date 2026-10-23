# Apex public read-only demo. Builds everything and serves the dashboard + API on $PORT.
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production APEX_PUBLIC_DEMO=1 STRIKE_ENV=mainnet APEX_MODE=paper
EXPOSE 8787
CMD ["node", "packages/api/dist/index.js"]
