"""In-memory rate limiting for the scoring endpoints: per visitor for the public demo, per user once signed in.

A single process holds the counters, which matches the single-instance deployment.
"""

from __future__ import annotations

import hmac
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.auth import require_session

RATE_LIMITED = "Too many requests. Please wait a minute and try again."
CLIENT_HEADER = "x-demo-client"
PROXY_SECRET_HEADER = "x-demo-proxy-secret"
MAX_CLIENT_KEY_LENGTH = 64
RATE_LIMIT_WINDOW_SECONDS = 60.0


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
        cutoff = now - RATE_LIMIT_WINDOW_SECONDS
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


def _from_trusted_proxy(request: Request) -> bool:
    secret = request.app.state.settings.demo_proxy_secret
    sent = request.headers.get(PROXY_SECRET_HEADER, "")
    return bool(secret) and hmac.compare_digest(sent.encode(), secret.encode())


def client_key(request: Request) -> str:
    # Only the frontend proxy, proven by the shared secret, may name the visitor. Anyone else calling the
    # API directly is keyed by their socket address, so rotating X-Demo-Client can't dodge the limit.
    forwarded = request.headers.get(CLIENT_HEADER, "").strip()
    if forwarded and _from_trusted_proxy(request):
        return forwarded[:MAX_CLIENT_KEY_LENGTH]
    return request.client.host if request.client else "unknown"


def _rate_limited() -> HTTPException:
    return HTTPException(429, RATE_LIMITED, headers={"Retry-After": str(int(RATE_LIMIT_WINDOW_SECONDS))})


async def require_demo_quota(request: Request) -> None:
    if not request.app.state.demo_limiter.allow(client_key(request)):
        raise _rate_limited()


async def require_scoring_quota(request: Request, claims: Annotated[dict, Depends(require_session)]) -> dict:
    # Keyed by the verified user, so one account can't exhaust scoring for everyone else.
    if not request.app.state.scoring_limiter.allow(claims["sub"]):
        raise _rate_limited()
    return claims


# The verified user's claims, after they pass the per-user scoring limit.
ScoredClaims = Annotated[dict, Depends(require_scoring_quota)]
