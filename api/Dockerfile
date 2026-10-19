# --- build ---------------------------------------------------------------------
FROM golang:1.27-alpine AS build
WORKDIR /src
# Dependências primeiro: a camada fica em cache enquanto go.mod/go.sum não mudarem.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# --- runtime -------------------------------------------------------------------
FROM alpine:3.22
# Usuário sem privilégios: o processo não precisa (nem deve) rodar como root.
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/api /usr/local/bin/api
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/api/healthz >/dev/null || exit 1
ENTRYPOINT ["api"]
