FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb

RUN useradd --create-home --uid 10001 solver
WORKDIR /work
USER 10001:10001
ENTRYPOINT ["/bin/sh"]
