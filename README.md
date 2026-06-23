# YouTube Video Downloader

## Local Redis server

Run Redis locally with Docker Compose before starting the backend:

```bash
docker compose up -d redis
```

Then point the backend at the local Redis server:

```bash
cp .env.example .env
export REDIS_URL=redis://localhost:6379/0
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

Server-side downloads are tracked through Redis when `REDIS_URL` is set. This is
required for production deployments that run multiple Flask workers because each
worker has its own memory space. Redis lets any worker answer status, file, and
cleanup requests for a job created by another worker.

Required environment:

```bash
REDIS_URL=redis://localhost:6379/0
```

Optional environment:

```bash
# Defaults to 86400 seconds (24 hours)
DOWNLOAD_TASK_TTL_SECONDS=86400
```

If `REDIS_URL` is not set, the backend falls back to an in-memory tracker for
single-process local development only.
