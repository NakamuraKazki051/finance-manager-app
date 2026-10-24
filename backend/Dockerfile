# syntax=docker/dockerfile:1
# 本番(EC2)用の Rails API のイメージ。infra/terraform/deploy.ps1 がこのPCでビルドし、S3 経由で EC2 に送る
# (EC2 はメモリ1GBなので、ネイティブ拡張の gem をそこでビルドしない)

FROM ruby:4.0.7-slim AS base
WORKDIR /rails
ENV RAILS_ENV=production \
    BUNDLE_DEPLOYMENT=1 \
    BUNDLE_PATH=/usr/local/bundle \
    BUNDLE_WITHOUT=development:test \
    RAILS_LOG_TO_STDOUT=1
# 実行に必要なのは MySQL(MariaDB)のクライアントライブラリだけ
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y libmariadb3 curl && \
    rm -rf /var/lib/apt/lists/*

FROM base AS build
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential default-libmysqlclient-dev pkg-config libyaml-dev && \
    rm -rf /var/lib/apt/lists/*
COPY Gemfile Gemfile.lock ./
# Bundler 4.0.20 は、deployment(frozen)のままだとネイティブ拡張の gem を入れたあとに、Gemfile.lock を変えなくてよいのに
# 「lockfile needs to be updated」で止まる。frozen を外して入れ、Gemfile.lock が1文字でも変わったらビルドを失敗させて、
# frozen と同じく「Gemfile.lock どおりの gem だけを入れる」ことを守る
RUN cp Gemfile.lock /tmp/Gemfile.lock.orig && \
    BUNDLE_DEPLOYMENT=0 bundle install && \
    diff -u /tmp/Gemfile.lock.orig Gemfile.lock && \
    rm -rf ~/.bundle "${BUNDLE_PATH}"/ruby/*/cache /tmp/Gemfile.lock.orig
COPY . .
RUN bundle exec bootsnap precompile app/ lib/

FROM base
COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build /rails /rails
RUN useradd rails --create-home --shell /bin/bash && \
    mkdir -p log tmp && chown -R rails:rails log tmp
USER rails
EXPOSE 3000
# 起動のたびに未適用のマイグレーションを流してから、Puma を1プロセスで起動する(メモリ節約)
CMD ["sh", "-c", "bin/rails db:prepare && exec bin/rails server -b 0.0.0.0 -p 3000"]
