FROM node:22-alpine
WORKDIR /workspace

COPY  package.json ./
RUN npm install --omit=dev

COPY . ./

ENV PORT=8080
EXPOSE 8080
USER node

CMD ["node", "index.js"]

