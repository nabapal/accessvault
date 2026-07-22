# syntax=docker/dockerfile:1

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Build metadata (traceability): passed by docker compose / deploy.sh.
ARG VERSION=0.0.0-dev
ARG GIT_SHA=dev
ARG BUILD_DATE=
ENV APP_VERSION=$VERSION \
    GIT_SHA=$GIT_SHA \
    BUILD_DATE=$BUILD_DATE
LABEL org.opencontainers.image.title="NetVerse AI backend" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.source="https://github.com/nabapal/accessvault"

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
# Bundle VERSION so the app reports the right version even if APP_VERSION isn't
# passed as a build arg (fallback read at /app/VERSION).
COPY VERSION ./VERSION

# Ensure the application can create the data directory at runtime if it does not exist.
RUN mkdir -p /app/data

ENV PYTHONPATH=/app/backend

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
