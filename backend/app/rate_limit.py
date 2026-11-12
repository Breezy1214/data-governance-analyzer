"""In-memory rate limiting for the unauthenticated demo endpoint.

A single process holds the counters, which matches the single-instance deployment.
"""

from __future__ import annotations

import time
from collections import OrderedDict, deque
from collections.abc import Callable

from fastapi import HTTPException, Request

RATE_LIMITED = "Too many requests. Please wait a minute and try again."
CLIENT_HEADER = "x-demo-client"
MAX_CLIENT_KEY_LENGTH = 64
WINDOW_SECONDS = 60.0


class SlidingWindowLimiter:
    """Allows `per_client` requests per client and `total` overall within a rolling window.

    Not thread-safe; it is only called from the event loop.
    """

    def __init__(self, per_client: int, total: int, clock: Callable[[], float] = time.monotonic) -> None:
        if per_client <= 0 or total <= 0:
            raise ValueError("Rate limits must be positive")
        self.per_client = per_client
        self.total = total
        self.clock = clock
        # Ordered by each client's latest allowed request, so idle clients sit at the front.
        self._clients: OrderedDict[str, deque[float]] = OrderedDict()
        self._all: deque[float] = deque()

    def allow(self, client: str) -> bool:
        now = self.clock()
        cutoff = now - WINDOW_SECONDS
        _expire(self._all, cutoff)
        hits = self._clients.get(client)
        if hits is not None:
            _expire(hits, cutoff)
        if len(self._all) >= self.total or (hits is not None and len(hits) >= self.per_client):
            return False
        if hits is None:
            hits = self._clients[client] = deque()
        else:
            self._clients.move_to_end(client)
        hits.append(now)
        self._all.append(now)
        while self._clients:
            oldest = next(iter(self._clients.values()))
            if oldest and oldest[-1] > cutoff:
                break
            self._clients.popitem(last=False)
        return True


def _expire(hits: deque[float], cutoff: float) -> None:
    while hits and hits[0] <= cutoff:
        hits.popleft()


def client_key(request: Request) -> str:
    # The frontend proxy forwards the browser's address; direct callers still share the global cap.
    forwarded = request.headers.get(CLIENT_HEADER, "").strip()
    if forwarded:
        return forwarded[:MAX_CLIENT_KEY_LENGTH]
    return request.client.host if request.client else "unknown"


async def require_demo_quota(request: Request) -> None:
    if not request.app.state.demo_limiter.allow(client_key(request)):
        raise HTTPException(429, RATE_LIMITED)
