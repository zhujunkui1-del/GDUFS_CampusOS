FROM public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.mjs ./
COPY build/evaluate-redbook.mjs ./build/evaluate-redbook.mjs
EXPOSE 8080
CMD ["node","server.mjs"]
