# Dockerfile for Motion Monitor - 微信云托管
FROM python:3.11-slim

WORKDIR /app

# Install OpenCV dependencies (libgl1-mesa-glx renamed to libgl1 in Debian Trixie)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
