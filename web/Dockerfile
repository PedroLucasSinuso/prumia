# --- build ---------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime: nginx serve o estático. A configuração (proxy /api, cache, headers) vem
# --- de deploy/nginx/default.conf, montada pelo compose. -----------------------------
# nginx-unprivileged: mesma imagem oficial, mas o processo roda como o usuário nginx (uid 101), sem root, e escuta na 8080.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
