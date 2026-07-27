FROM python:3.12.4-slim-bookworm@sha256:a3e58f9399353be051735f09be0316bfdeab571a5c6a24fd78b92df85bcb2d85

ARG PALIMPSEST_SANDBOX_SOURCE_DIGEST

LABEL org.palimpsest.puzzle-sandbox.profile-version="1"
LABEL org.palimpsest.puzzle-sandbox.source-digest="${PALIMPSEST_SANDBOX_SOURCE_DIGEST}"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        diffutils \
        findutils \
        git \
        grep \
        sed \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /evidence /reference /git/shared.git /input \
    && touch /input/ciphertext.txt

WORKDIR /workspace
