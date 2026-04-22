# Dockerfile for Motion Monitor - 微信云托管
# 多阶段构建 + 非 root 用户 + 健康检查
FROM python:3.11-slim

WORKDIR /app

# Install OpenCV dependencies
# Note: libgl1-mesa-glx was renamed to libgl1 in Debian Trixie (python:3.11-slim base)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

# Install Python dependencies first (layer cache optimization)
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY server/ .

# Change ownership to non-root user
RUN chown -R appuser:appuser /app
USER appuser

# Health check - cloud hosting uses this to determine service status
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
