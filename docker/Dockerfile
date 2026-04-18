# Stage 1: Build Angular frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend + serve Angular dist
FROM python:3.11-slim
WORKDIR /app

# Create app user/group
RUN addgroup --gid 1000 appgroup && \
    adduser --uid 1000 --ingroup appgroup --gecos "" --shell /bin/false appuser

# Install gosu to drop privileges
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates gnupg wget && \
    wget -O /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/1.16/gosu-$(dpkg --print-architecture)" && \
    chmod +x /usr/local/bin/gosu && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ENV PUID=1000
ENV PGID=1000


COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY backend/ ./

# Copy Angular build output
COPY --from=frontend-build /app/frontend/dist/gaps-2 /app/frontend/dist/gaps-2

# Create data directory for persistent config
RUN mkdir -p /app/data

EXPOSE 5000

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "run:app"]
