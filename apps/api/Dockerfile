# ==============================================================================
# Stage 1: builder — 安裝依賴並建立虛擬環境
# ==============================================================================
FROM python:3.12-slim@sha256:a39549e211a16149edf74e5fdc9ef03a6767e46cd987c5048b6659b6c9904c94 AS builder

# 安裝 uv
COPY --from=ghcr.io/astral-sh/uv:0.7.13@sha256:6c1e19020ec221986a210027040044a5df8de762eb36d5240e382bc41d7a9043 /uv /uvx /usr/local/bin/

WORKDIR /build

# 僅複製依賴定義檔（利用 Docker 層快取）
COPY apps/api/pyproject.toml apps/api/
COPY libs/shared/pyproject.toml libs/shared/
COPY pyproject.toml ./

# 安裝所有依賴到 /build/.venv（不包含開發工具）
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --project apps/api --no-dev --no-editable --no-install-project

# ==============================================================================
# Stage 2: runtime — 最小化生產映像檔
# ==============================================================================
FROM python:3.12-slim@sha256:a39549e211a16149edf74e5fdc9ef03a6767e46cd987c5048b6659b6c9904c94 AS runtime

# WeasyPrint needs native text/layout libraries; Noto CJK keeps generated PDFs readable.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        fontconfig \
        fonts-noto-cjk \
        gnupg \
        libgdk-pixbuf-2.0-0 \
        libharfbuzz-subset0 \
        libjpeg62-turbo \
        libopenjp2-7 \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        postgresql-client && \
    mkdir -p /usr/share/fonts/truetype/hcca /usr/share/fonts/opentype/noto-custom && \
    rm -rf /var/lib/apt/lists/*

# 建立非 root 使用者（安全最佳實踐）
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --no-create-home appuser

WORKDIR /app

ARG APP_VERSION=0.1.0
ARG BUILD_COMMIT=
ARG BUILD_REF=
ARG BUILD_TIME=

# 從 builder 複製虛擬環境
COPY --from=builder /build/.venv /app/.venv

# 複製應用程式原始碼
COPY apps/api/src /app/src
COPY libs/shared/src /app/src
COPY fonts/LXGWWenKaiTC-Regular.ttf /app/fonts/LXGWWenKaiTC-Regular.ttf
RUN fc-cache -f
COPY apps/api/scripts /app/scripts
COPY apps/api/data /app/data
COPY apps/api/alembic /app/alembic
COPY apps/api/alembic.ini /app/alembic.ini
COPY apps/api/gunicorn.conf.py /app/gunicorn.conf.py
COPY VERSION /app/VERSION

RUN mkdir -p /app/uploads /app/backups && chown -R appuser:appgroup /app/uploads /app/backups

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH="/app/src" \
    APP_VERSION=$APP_VERSION \
    BUILD_COMMIT=$BUILD_COMMIT \
    BUILD_REF=$BUILD_REF \
    BUILD_TIME=$BUILD_TIME

USER appuser

EXPOSE 8000

# 生產：Gunicorn + UvicornWorker（多 worker 充分利用多核）
# 開發：CMD 可被 docker-compose override 為 uvicorn --reload
CMD ["python", "-m", "gunicorn.app.wsgiapp", "api.main:app", "--config", "/app/gunicorn.conf.py"]
