# israel-transit-mcp — packaged MCP server.
#
# Build:   docker build -t israel-transit-mcp .
# Run:     docker run --rm -i -e GOOGLE_MAPS_API_KEY=... israel-transit-mcp
#
# The image is intentionally minimal — python:3.11-slim + the package +
# its runtime deps. No model files, no GTFS bundles baked in. Anything
# stateful (the SQLite store) goes in a mounted volume so the personal
# baseline survives container restarts:
#
#   docker run --rm -i \
#     -e GOOGLE_MAPS_API_KEY=... \
#     -e ISRAEL_TRANSIT_STORE_DIR=/data \
#     -v $HOME/.israel-transit-mcp:/data \
#     israel-transit-mcp

FROM python:3.11-slim AS base

# Tiny set of build tools required only for lxml (has wheels on most
# arches but falling back to source build keeps us portable).
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends gcc libxml2-dev libxslt1-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what we need to install — keeps the layer cacheable.
COPY pyproject.toml README.md ./
COPY src/ ./src/

RUN pip install --no-cache-dir -e .

# Default store dir inside the container; override at runtime to mount.
ENV ISRAEL_TRANSIT_STORE_DIR=/data
RUN mkdir -p /data

# MCP servers speak JSON-RPC on stdio. `-i` on docker run is mandatory.
ENTRYPOINT ["israel-transit-mcp"]
