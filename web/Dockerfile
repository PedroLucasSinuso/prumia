# --- build ---------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime: nginx serve o estático. A configuração (proxy /api, cache, headers) vem
# --- de deploy/nginx/default.conf, montada pelo compose. -----------------------------
FROM nginx:alpine
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
