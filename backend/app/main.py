"""Aplicación FastAPI de AgroDSS (T007).

``uvicorn app.main:app`` la sirve. Rutas bajo ``/api/v1``; documentación en ``/docs`` y
``/openapi.json``. CORS con los orígenes de la configuración (por defecto
``http://localhost:5173``). Toda respuesta lleva ``X-Request-ID``.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import load_settings
from app.core.constants import CONTRACT_VERSION, MODEL_VERSION
from app.core.error_handlers import register_error_handlers
from app.core.request_context import REQUEST_ID_HEADER, install_request_id
from app.models.examples import REQUEST_EXAMPLE, RESPONSE_EXAMPLE
from app.routers import catalog, health, simulations

API_PREFIX = "/api/v1"

DESCRIPTION = (
    "AgroDSS compara rotaciones de cultivos de secano con escenarios históricos descriptivos: "
    "balance hídrico FAO-56, respuesta del rendimiento FAO-33 y series diarias de NASA POWER. "
    "No emite pronósticos ni recomendaciones."
)


def _keep_explicit_nulls_in_examples(app: FastAPI) -> None:
    """FastAPI quita los ``null`` de los ejemplos al generar el esquema; aquí se restituyen.

    En este contrato un ``null`` explícito significa «no aplica» (plan §5.1), así que el ejemplo
    de la documentación debe conservarlo.
    """
    original = app.openapi

    def openapi() -> dict:
        if app.openapi_schema is None:
            schema = original()
            post = schema["paths"][f"{API_PREFIX}/simulations"]["post"]
            body = post["requestBody"]["content"]["application/json"]
            body["examples"]["plan"]["value"] = REQUEST_EXAMPLE
            post["responses"]["200"]["content"]["application/json"]["example"] = RESPONSE_EXAMPLE
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]


def create_app() -> FastAPI:
    settings = load_settings()
    app = FastAPI(
        title="AgroDSS",
        description=DESCRIPTION,
        version=MODEL_VERSION,
        summary=f"Contrato {CONTRACT_VERSION}",
    )
    app.state.cors_origins = settings.cors_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    install_request_id(app)  # al final: es el más externo y asigna el identificador primero
    register_error_handlers(app)
    for router in (health.router, catalog.router, simulations.router):
        app.include_router(router, prefix=API_PREFIX)
    _keep_explicit_nulls_in_examples(app)
    return app


app = create_app()
