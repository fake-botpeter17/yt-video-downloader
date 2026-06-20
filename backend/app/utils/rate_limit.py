"""Tiny in-memory rate limiter suitable for single-process deployments."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Callable
from functools import wraps

from flask import jsonify, request

_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


def rate_limit(max_requests: int = 30, window_seconds: int = 60) -> Callable:
    """Limit requests by remote address without leaking internal details."""

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            now = time.time()
            key = request.headers.get(
                "X-Forwarded-For", request.remote_addr or "unknown"
            ).split(",")[0]
            bucket = _BUCKETS[key]
            while bucket and now - bucket[0] > window_seconds:
                bucket.popleft()
            if len(bucket) >= max_requests:
                return (
                    jsonify(
                        {
                            "error": "Too many requests. Please wait a moment and try again."
                        }
                    ),
                    429,
                )
            bucket.append(now)
            return fn(*args, **kwargs)

        return wrapper

    return decorator
