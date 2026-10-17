FROM python:3.12.10-slim-bookworm
ARG UV_VERSION=0.11.23
RUN pip install --no-cache-dir uv==${UV_VERSION} && apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/browser/pyproject.toml workers/browser/uv.lock ./
RUN uv sync --locked --no-dev
RUN useradd --create-home --uid 10001 browser
COPY --chown=browser:browser workers/browser/worker.py ./
ENV JARVIS_CONTAINER=true ANONYMIZED_TELEMETRY=false BROWSER_USE_LOGGING_LEVEL=error
USER browser
EXPOSE 8765
CMD [".venv/bin/python", "worker.py"]
