#!/bin/bash
# EC2の初回起動時に1回だけ実行されるセットアップ。
# Docker と DB（PostgreSQL）までを用意する。アプリ本体（app.jar）は後でデプロイする。
set -euxo pipefail

# メモリ1GBでは Spring Boot と PostgreSQL が同時に動かないことがあるので、2GBのスワップを作る
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

dnf install -y docker
systemctl enable --now docker

# Amazon Linux 2023 の docker パッケージには compose が入っていないので追加する
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

APP_DIR=/opt/task-manager
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# DBのパスワードはサーバー上で作り、Terraform の state やGitには残さない
if [ ! -f .env ]; then
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
  chmod 600 .env
fi

cat > docker-compose.yml <<'EOF'
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: taskmanager
      POSTGRES_USER: taskmanager
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    mem_limit: 256m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U taskmanager -d taskmanager"]
      interval: 10s
      timeout: 5s
      retries: 5

  # app.jar を /opt/task-manager に置いてから `docker compose up -d app` で起動する
  app:
    image: eclipse-temurin:17-jre
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/taskmanager
      SPRING_DATASOURCE_USERNAME: taskmanager
      SPRING_DATASOURCE_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./app.jar:/app/app.jar:ro
    command: ["java", "-Xmx384m", "-Xss512k", "-XX:MaxMetaspaceSize=128m", "-jar", "/app/app.jar"]
    ports:
      - "80:8080"
    mem_limit: 640m

volumes:
  db-data:
EOF

docker compose up -d db
