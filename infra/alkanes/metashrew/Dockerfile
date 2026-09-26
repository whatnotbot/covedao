# metashrew (rockshrew-mono) with the alkanes indexer, tuned for a local
# regtest where blocks arrive on demand. Upstream's image ships an older
# rockshrew-mono with production retry/backoff and poll intervals sized for
# 10-minute blocks, which made each local block take tens of seconds.
FROM rust:1-slim-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git pkg-config clang libclang-dev libssl-dev cmake protobuf-compiler ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# v9.0.2 = b0f554c3afce72e5fed13c0be1ee34355bdee0af (MIT, sandshrewmetaprotocols/metashrew)
RUN git clone --depth 1 -b v9.0.2 https://github.com/sandshrewmetaprotocols/metashrew.git . \
    && test "$(git rev-parse HEAD)" = "b0f554c3afce72e5fed13c0be1ee34355bdee0af" \
    && rm -f rust-toolchain.toml
COPY local-regtest.patch /build/local-regtest.patch
RUN git apply /build/local-regtest.patch
RUN cargo build --release -p rockshrew-mono

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/rockshrew-mono /usr/local/bin/rockshrew-mono
# The alkanes indexer (regtest build: alkanes active from block 0), pinned by hash,
# from kungfuflex/alkanes@7a3326b docker/metashrew/vendor/alkanes.wasm.
ADD --checksum=sha256:ba8fa6329c6ba58109d0331a892ea21ad0d2285065644ad2d9fbfbeecb937194 \
    https://raw.githubusercontent.com/kungfuflex/alkanes/7a3326b12702c044424d10b37c048e06ebefb3d2/docker/metashrew/vendor/alkanes.wasm \
    /metashrew/indexer.wasm
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data
ENTRYPOINT ["/entrypoint.sh"]
