FROM public.ecr.aws/docker/library/node:22-bookworm-slim
WORKDIR /service
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY build/server.mjs ./server.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node","server.mjs"]
