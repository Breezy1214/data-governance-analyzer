"""Streaming request-size protection for the public API."""

from __future__ import annotations

import uuid

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.logging_config import logger


class RequestBodyLimitMiddleware:
    """Reject bodies over max_bytes, including chunked ones.

    Buffers at most max_bytes before replaying the body to the app.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        if max_bytes <= 0:
            raise ValueError("max_bytes must be positive")
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > self.max_bytes:
                    await self._reject(scope, receive, send)
                    return
            except ValueError:
                # The application will return the normal validation response.
                pass

        body = bytearray()
        disconnected = False
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                disconnected = True
                break
            if message["type"] != "http.request":
                continue
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                await self._reject(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        delivered = False

        async def replay_receive() -> Message:
            nonlocal delivered
            if delivered or disconnected:
                return {"type": "http.disconnect"}
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay_receive, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        request_id = str(uuid.uuid4())
        logger.warning(
            "request_body_too_large",
            extra={"fields": {"requestId": request_id, "maxRequestBytes": self.max_bytes}},
        )
        response = JSONResponse(
            status_code=413,
            content={
                "error": "request_too_large",
                "message": f"Request body must not exceed {self.max_bytes} bytes.",
                "requestId": request_id,
            },
        )
        await response(scope, receive, send)
