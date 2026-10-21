# SPDX-License-Identifier: Apache-2.0
#
# Alcazar: the COBOL / Fortran core is compiled AND tested in the build
# stage (the image cannot be built from code that fails its tests); the
# runtime stage holds no compiler, runs as an unprivileged user, and starts
# Gatehouse under the Node.js permission model.
#
# Base images are pinned by digest (and no `# syntax=` frontend image is
# pulled); Dependabot keeps the digests current.

# ---- build ---------------------------------------------------------------
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol3 gfortran make \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Makefile ./
COPY scripts/ scripts/
COPY rampart/ rampart/
COPY apps/ apps/
RUN make all && make test

# ---- runtime -------------------------------------------------------------
FROM node:26-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4
RUN apt-get update \
 && apt-get install -y --no-install-recommends libcob4t64 libgfortran5 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 alcazar \
 && useradd --system --uid 10001 --gid alcazar --home-dir /nonexistent --shell /usr/sbin/nologin alcazar
WORKDIR /app
COPY --from=build /src/build/bin/txnguard /src/build/bin/ledgerck /src/build/bin/fraudscan \
                  /src/build/bin/alzselftest /src/build/bin/alzsum build/bin/
COPY --from=build /src/build/manifest.json build/
COPY package.json ./
COPY scripts/start-hardened.mjs scripts/
COPY gatehouse/src/ gatehouse/src/
COPY shared/ shared/
COPY watchtower/src/ watchtower/src/
COPY lookout/ lookout/
# Sources scanned by Watchtower for the dashboard's self-scan report.
COPY rampart/ rampart/
COPY apps/ apps/
COPY examples/ examples/

ENV NODE_ENV=production \
    ALCAZAR_HOST=0.0.0.0 \
    ALCAZAR_PORT=8080 \
    ALCAZAR_WORK_DIR=/tmp/alcazar
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# The launcher creates the job directory, then starts Gatehouse under the
# Node.js permission model (read: /app; write: the job directory; spawn the
# legacy programs). See docs/HARDENING.md, items 14-16.
CMD ["node", "scripts/start-hardened.mjs"]
