FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run db:generate -w @worknoon/api && npm run build -w @worknoon/api
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm", "run", "start:container", "-w", "@worknoon/api"]
