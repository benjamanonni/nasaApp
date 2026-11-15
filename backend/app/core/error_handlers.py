"""Manejadores de errores HTTP: un único formato en español (RF-16; T034 y T041).

Traduce a ``{"error": {...}}`` (plan §5.5):

| Origen                                              | HTTP | category / code                    |
|-----------------------------------------------------|------|------------------------------------|
| cuerpo inválido (Pydantic)                          | 422  | input / invalid_input              |
| dato de riego en el cuerpo                          | 422  | input / irrigation_not_supported   |
| incoherencias semánticas (``InputValidationError``) | 422  | input / invalid_input              |
| ``PowerUnreachableError``                           | 503  | nasa_power / power_unreachable     |
| ``PowerTimeoutError``                               | 504  | nasa_power / power_timeout         |
| ``PowerRateLimitedError``                           | 503  | nasa_power / power_rate_limited    |
| ``PowerBadResponseError``                           | 502  | nasa_power / power_bad_response    |
| ``CalculationIntegrityError``                       | 500  | internal / calculation_integrity   |
| cualquier otra excepción                            | 500  | internal / unexpected_error        |

Los detalles técnicos (pila de llamadas, valores intermedios) van solo al registro del servidor,
junto al ``request_id``; nunca a la respuesta (CA-16.5). Todo error lleva el ``request_id`` que
también viaja en la cabecera ``X-Request-ID``.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core import messages
from app.core.config import load_settings
from app.core.exceptions import (
    AgroDSSError,
    CalculationIntegrityError,
    InputValidationError,
    PowerBadResponseError,
    PowerRateLimitedError,
    PowerTimeoutError,
    PowerUnreachableError,
)
from app.core.request_context import REQUEST_ID_HEADER, request_id_of
from app.models.errors import ErrorBody, ErrorDetail, ErrorResponse

logger = logging.getLogger("agrodss")

CODE_INVALID_INPUT = "invalid_input"
CODE_IRRIGATION = "irrigation_not_supported"
HTTP_UNPROCESSABLE = 422


# --- Traducción de los errores de Pydantic ---


def field_path(location: Sequence[str | int]) -> str:
    """``("body", "rotations", 0, "crops", 1, "ym_t_ha")`` → ``rotations[0].crops[1].ym_t_ha``."""
    parts = list(location)
    if parts and parts[0] in ("body", "query", "path"):
        parts = parts[1:]
    path = ""
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        else:
            path += f".{part}" if path else str(part)
    return path or messages.BODY_FIELD


def _is_irrigation_key(name: str) -> bool:
    lowered = name.lower()
    return "irrig" in lowered or "riego" in lowered


def spanish_message(error: dict[str, Any]) -> str:
    """Mensaje en español de un error de Pydantic, según su tipo."""
    kind = error.get("type", "")
    ctx = error.get("ctx") or {}
    location = error.get("loc") or ()
    name = str(location[-1]) if location else ""
    simple = {
        "missing": messages.FIELD_MISSING,
        "int_parsing": messages.MUST_BE_INTEGER,
        "int_from_float": messages.MUST_BE_INTEGER,
        "int_type": messages.MUST_BE_INTEGER,
        "float_parsing": messages.MUST_BE_NUMBER,
        "float_type": messages.MUST_BE_NUMBER,
        "finite_number": messages.MUST_BE_FINITE,
        "string_type": messages.MUST_BE_TEXT,
        "bool_type": messages.MUST_BE_BOOLEAN,
        "bool_parsing": messages.MUST_BE_BOOLEAN,
        "dict_type": messages.MUST_BE_OBJECT,
        "model_attributes_type": messages.MUST_BE_OBJECT,
        "model_type": messages.MUST_BE_OBJECT,
        "list_type": messages.MUST_BE_LIST,
    }
    if kind in simple:
        return simple[kind]
    if kind == "extra_forbidden":
        template = messages.IRRIGATION_FIELD if _is_irrigation_key(name) else messages.FIELD_UNKNOWN
        return template.format(name=name)
    templates = {
        "greater_than": messages.MUST_BE_GREATER,
        "greater_than_equal": messages.MUST_BE_GREATER_EQUAL,
        "less_than": messages.MUST_BE_LESS,
        "less_than_equal": messages.MUST_BE_LESS_EQUAL,
        "too_short": messages.LIST_TOO_SHORT,
        "too_long": messages.LIST_TOO_LONG,
        "string_too_short": messages.TEXT_TOO_SHORT,
        "string_too_long": messages.TEXT_TOO_LONG,
        "string_pattern_mismatch": messages.PATTERN_MISMATCH,
        "literal_error": messages.LITERAL_MISMATCH,
    }
    if kind in templates:
        try:
            return templates[kind].format(**ctx)
        except (KeyError, ValueError, IndexError):
            return messages.VALUE_INVALID
    if kind == "json_invalid":
        return messages.BODY_NOT_JSON
    return messages.VALUE_INVALID


def validation_details(errors: Sequence[dict[str, Any]]) -> list[ErrorDetail]:
    details = []
    for error in errors:
        kind = error.get("type", "")
        location = error.get("loc") or ()
        field = messages.BODY_FIELD if kind == "json_invalid" else field_path(location)
        details.append(ErrorDetail(field=field, message=spanish_message(error), code=kind or None))
    return details


def has_irrigation_data(errors: Sequence[dict[str, Any]]) -> bool:
    """Alguna clave desconocida que contiene «irrig» o «riego» (CA-1.8)."""
    return any(
        error.get("type") == "extra_forbidden"
        and error.get("loc")
        and _is_irrigation_key(str(error["loc"][-1]))
        for error in errors
    )


# --- Respuestas ---


def error_response(
    request: Request,
    *,
    status_code: int,
    category: str,
    code: str,
    message: str,
    retryable: bool,
    details: list[ErrorDetail] | None = None,
) -> JSONResponse:
    request_id = request_id_of(request)
    body = ErrorResponse(
        error=ErrorBody(
            category=category,  # type: ignore[arg-type]
            code=code,
            message=message,
            retryable=retryable,
            request_id=request_id,
            details=details,
        )
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(mode="json", exclude_none=True),
        headers={REQUEST_ID_HEADER: request_id},
    )


async def handle_request_validation(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, RequestValidationError)
    errors = list(error.errors())
    irrigation = has_irrigation_data(errors)
    return error_response(
        request,
        status_code=HTTP_UNPROCESSABLE,
        category="input",
        code=CODE_IRRIGATION if irrigation else CODE_INVALID_INPUT,
        message=messages.IRRIGATION_NOT_SUPPORTED if irrigation else messages.INPUT_INVALID,
        retryable=False,
        details=validation_details(errors),
    )


async def handle_input_validation(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, InputValidationError)
    details = [
        ErrorDetail(field=item["field"], message=item["message"], code=item.get("code"))
        for item in error.details
    ]
    return error_response(
        request,
        status_code=HTTP_UNPROCESSABLE,
        category="input",
        code=error.code,
        message=messages.INPUT_INVALID,
        retryable=False,
        details=details,
    )


async def handle_power_error(request: Request, error: Exception) -> JSONResponse:
    if isinstance(error, PowerTimeoutError):
        seconds = error.timeout_s or load_settings().power_read_timeout_s
        status, message = 504, messages.POWER_TIMEOUT.format(seconds=seconds)
    elif isinstance(error, PowerRateLimitedError):
        status, message = 503, messages.POWER_RATE_LIMITED
    elif isinstance(error, PowerUnreachableError):
        status, message = 503, messages.POWER_UNREACHABLE
    elif isinstance(error, PowerBadResponseError) and error.status_code is not None:
        status, message = 502, messages.POWER_BAD_STATUS.format(status=error.status_code)
    else:
        status, message = 502, messages.POWER_BAD_FORMAT
    assert isinstance(error, AgroDSSError)
    logger.warning(
        "Falla de NASA POWER (%s) [request_id=%s]: %s", error.code, request_id_of(request), error
    )
    return error_response(
        request,
        status_code=status,
        category=error.category,
        code=error.code,
        message=message,
        retryable=error.retryable,
    )


async def handle_integrity_error(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, CalculationIntegrityError)
    logger.error(
        "Falla de integridad del cálculo [request_id=%s, rotación=%s, año=%s, cierre=%s]: %s",
        request_id_of(request),
        error.rotation_id,
        error.start_year,
        error.closure_mm,
        error,
    )
    return error_response(
        request,
        status_code=500,
        category="internal",
        code=error.code,
        message=messages.CALCULATION_INTEGRITY,
        retryable=False,
    )


async def handle_http_exception(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, StarletteHTTPException)
    known = {
        404: ("not_found", messages.NOT_FOUND),
        405: ("method_not_allowed", messages.METHOD_NOT_ALLOWED),
    }
    code, message = known.get(error.status_code, ("http_error", messages.HTTP_ERROR))
    return error_response(
        request,
        status_code=error.status_code,
        category="input",
        code=code,
        message=message,
        retryable=False,
    )


async def handle_unexpected(request: Request, error: Exception) -> JSONResponse:
    code = error.code if isinstance(error, AgroDSSError) else "unexpected_error"
    logger.exception("Error inesperado [request_id=%s]", request_id_of(request), exc_info=error)
    response = error_response(
        request,
        status_code=500,
        category="internal",
        code=code,
        message=messages.UNEXPECTED_ERROR,
        retryable=False,
    )
    # Starlette's outer ServerErrorMiddleware handles these responses outside CORSMiddleware.
    origin = request.headers.get("origin")
    if origin and origin in request.app.state.cors_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Expose-Headers"] = REQUEST_ID_HEADER
        response.headers.add_vary_header("Origin")
    return response


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, handle_request_validation)
    app.add_exception_handler(InputValidationError, handle_input_validation)
    for power_error in (
        PowerUnreachableError,
        PowerTimeoutError,
        PowerRateLimitedError,
        PowerBadResponseError,
    ):
        app.add_exception_handler(power_error, handle_power_error)
    app.add_exception_handler(CalculationIntegrityError, handle_integrity_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    app.add_exception_handler(Exception, handle_unexpected)
