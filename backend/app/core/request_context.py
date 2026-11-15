"""Identificador de solicitud (CA-16.4, plan §6.1; T007).

Cada solicitud recibe un UUID nuevo, disponible en ``request.state.request_id``, que viaja en la
cabecera ``X-Request-ID`` de toda respuesta y en el campo ``request_id`` de los errores y de la
respuesta de la simulación. No se acepta uno enviado por el cliente: así el identificador siempre
es del servidor y sirve para ubicar la solicitud en el registro.
"""

from __future__ import annotations

import logging
import uuid
from time import perf_counter

from fastapi import FastAPI, Request
from starlette.types import ASGIApp

REQUEST_ID_HEADER = "X-Request-ID"
SIMULATIONS_PATH = "/api/v1/simulations"
logger = logging.getLogger("uvicorn.error.agrodss")


def request_id_of(request: Request) -> str:
    """Identificador de la solicitud (uno nuevo si el middleware no corrió)."""
    request_id = getattr(request.state, "request_id", None)
    if request_id is None:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
    return request_id


class RequestIdMiddleware:
    """Asigna el identificador antes de atender la solicitud y lo agrega a la respuesta."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: object, send: object) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)  # type: ignore[arg-type,misc]
            return
        request_id = str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = request_id

        is_simulation = scope["path"] == SIMULATIONS_PATH and scope["method"] == "POST"
        started = perf_counter()
        status = 500
        if is_simulation:
            logger.info("Inicio POST %s request_id=%s", SIMULATIONS_PATH, request_id)

        async def send_with_id(message: dict) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != REQUEST_ID_HEADER.lower().encode()
                ]
                headers.append((REQUEST_ID_HEADER.lower().encode(), request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)  # type: ignore[operator]

        try:
            await self.app(scope, receive, send_with_id)  # type: ignore[arg-type,misc]
        finally:
            if is_simulation:
                logger.info(
                    "Fin POST %s status=%d duration_ms=%.0f request_id=%s",
                    SIMULATIONS_PATH, status, (perf_counter() - started) * 1000, request_id,
                )


def install_request_id(app: FastAPI) -> None:
    app.add_middleware(RequestIdMiddleware)
