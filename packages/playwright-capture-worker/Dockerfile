FROM mcr.microsoft.com/playwright:v1.55.1-noble@sha256:d8e0bdf35da90942fc8f97a65fa7f1969200ccd916ec0fd78780d80d9b81e07b

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg=7:6.1.1-3ubuntu5 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /worker
COPY packages/playwright-capture-worker/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY packages/playwright-capture-worker/src ./src

USER pwuser
ENTRYPOINT ["node", "src/cli.mjs"]
