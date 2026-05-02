# ==============================================================================
# Stage 1: builder — 安裝依賴並建立虛擬環境
# ==============================================================================
FROM python:3.12-slim AS builder

# 安裝 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /build

# 僅複製依賴定義檔（利用 Docker 層快取）
COPY apps/api/pyproject.toml apps/api/
COPY libs/shared/pyproject.toml libs/shared/
COPY pyproject.toml ./

# 安裝所有依賴到 /build/.venv（不包含開發工具）
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --project apps/api --no-dev --no-editable

# ==============================================================================
# Stage 2: runtime — 最小化生產映像檔
# ==============================================================================
FROM python:3.12-slim AS runtime

# 建立非 root 使用者（安全最佳實踐）
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --no-create-home appuser

WORKDIR /app

# 從 builder 複製虛擬環境
COPY --from=builder /build/.venv /app/.venv

# 複製應用程式原始碼
COPY apps/api/src /app/src
COPY libs/shared/src /app/src

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH="/app/src"

USER appuser

EXPOSE 8000

# 使用 Uvicorn（單 worker，生產環境建議搭配 Gunicorn）
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
