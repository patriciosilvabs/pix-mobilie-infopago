FROM node:18-alpine
WORKDIR /app
COPY docs/onz-proxy/package.json ./
RUN npm install --production
COPY docs/onz-proxy/index.js ./
EXPOSE 3000
CMD ["node", "index.js"]
