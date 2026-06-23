# YouTube Video Downloader

## Local Redis server

Run Redis locally with Docker Compose before starting the backend:

```bash
docker compose up -d redis
```

Then load the local Redis settings for the backend:

```bash
cp .env.example .env
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
```

You can verify the local Redis server is responding with:

```bash
docker compose exec redis redis-cli ping
```

Stop the local Redis server with:

```bash
docker compose down
```

## Production job tracking

Server-side downloads are tracked through the private local Redis server at
`127.0.0.1:6379` by default. This is required for deployments that run multiple
Flask workers because each worker has its own memory space. Redis lets any
worker answer status, file, and cleanup requests for a job created by another
worker.

Redis connection environment:

```bash
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

Optional environment:

```bash
# Defaults to 86400 seconds (24 hours)
DOWNLOAD_TASK_TTL_SECONDS=86400
```
