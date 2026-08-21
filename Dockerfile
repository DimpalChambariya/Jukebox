FROM node:18-alpine

WORKDIR /app

# Both client and admin import a sibling ../demo module via a Vite alias
COPY demo ./demo

# Build client first (before copying root package.json to avoid conflicts)
WORKDIR /app/client
COPY client/package.json ./
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY client ./
RUN npm run build

# Build admin (before copying root package.json to avoid conflicts)
WORKDIR /app/admin
COPY admin/package.json ./
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY admin ./
RUN npm run build

# Now copy server code and install server dependencies
WORKDIR /app
COPY server ./server
COPY package*.json ./
# better-sqlite3 falls back to a source build when its prebuilt binary can't be fetched
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install --production \
 && apk del .build-deps

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000 3001

CMD ["node", "server/index.js"]

