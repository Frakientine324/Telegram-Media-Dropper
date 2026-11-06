FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
    gperf \
    libssl-dev \
    zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --recursive --depth 1 \
  https://github.com/tdlib/telegram-bot-api.git \
  /src/telegram-bot-api

WORKDIR /src/telegram-bot-api

RUN cmake -S . -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/usr/local \
  && cmake --build build --target install -- -j2

FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libatomic1 \
    libssl3 \
    zlib1g \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 telegram \
  && useradd --system --uid 10001 --gid telegram --home-dir /nonexistent telegram \
  && mkdir -p /var/lib/telegram-bot-api \
  && chown telegram:telegram /var/lib/telegram-bot-api

COPY --from=builder /usr/local/bin/telegram-bot-api /usr/local/bin/telegram-bot-api
COPY start.sh /usr/local/bin/telegram-bot-api-entrypoint

USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["/bin/sh", "/usr/local/bin/telegram-bot-api-entrypoint"]
