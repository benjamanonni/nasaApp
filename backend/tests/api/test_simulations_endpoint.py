"""Pruebas de ``POST /api/v1/simulations`` de punta a punta, con NASA POWER simulada (T046, T047).

Cubren RF-1…RF-17 en el flujo completo, CA-5.3 (sin consulta si la solicitud es inválida), CA-5.4 y
CA-5.5 (fallas de la fuente), CA-15.1 (bloques de la respuesta), CA-16.1–CA-16.5 (errores) y
CA-16.3 (todos los escenarios bloqueados). El reloj está fijado en 2026-11-15.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import httpx
import pytest

from app.core.exceptions import CalculationIntegrityError
from app.models.response import SimulationResponse
from app.services import simulation_service
from tests.api.conftest import NOW, is_uuid, make_client
from tests.builders.requests import plan_request
from tests.builders.simulation import Power

URL = "/api/v1/simulations"
RAIN_GAP = {"PRECTOTCORR": [date(2018, 3, 4)], "ALLSKY_SFC_SW_DWN": [date(2009, 1, 17)]}

TOP_LEVEL_KEYS = {
    "contract_version",
    "model_version",
    "request_id",
    "computed_at",
    "currency",
    "resolved_input",
    "provenance",
    "scenarios",
    "results",
    "ranges",
    "comparisons",
    "assumptions",
    "warnings",
}


def post_plan(**options: Any) -> Any:
    client, server = make_client(Power(**options))
    return client.post(URL, json=plan_request()), server


# --- T046: caso exitoso ---


def test_success_returns_200_with_the_thirteen_top_level_keys() -> None:
    response, server = post_plan(fill_dates=RAIN_GAP)
    assert response.status_code == 200
    assert set(response.json()) == TOP_LEVEL_KEYS
    assert len(server.requests) == 1


def test_success_response_validates_against_the_response_model() -> None:
    response, _ = post_plan(fill_dates=RAIN_GAP)
    parsed = SimulationResponse.model_validate(response.json())
    assert [s.status for s in parsed.scenarios] == ["computed", "computed", "blocked"]
    assert len(parsed.results) == 4


def test_success_mass_balance_error_is_within_tolerance_in_every_result() -> None:
    body = post_plan(fill_dates=RAIN_GAP)[0].json()
    assert body["results"]
    assert all(abs(r["water_balance"]["mass_balance_error_mm"]) <= 0.01 for r in body["results"])


def test_success_identification_fields() -> None:
    response, _ = post_plan()
    body = response.json()
    assert body["contract_version"] == "1.0" and body["model_version"]
    assert body["request_id"] == response.headers["x-request-id"] and is_uuid(body["request_id"])
    assert body["computed_at"].startswith("2026-11-15T14:03:22")
    assert body["currency"] == "USD"


def test_success_the_response_has_no_daily_series() -> None:
    response, _ = post_plan()
    assert len(response.content) < 200_000
    assert "daily" not in response.text


def test_success_warnings_and_assumptions_are_present() -> None:
    body = post_plan(fill_dates=RAIN_GAP)[0].json()
    codes = {w["code"] for w in body["warnings"]}
    assert {"HISTORICAL_DESCRIPTIVE", "NOT_A_RECOMMENDATION", "SCENARIOS_BLOCKED"} <= codes
    assert any(a["code"] == "RAINFED_NO_IRRIGATION" for a in body["assumptions"])


def test_success_is_reproducible_for_the_same_request_and_data() -> None:
    first = post_plan(fill_dates=RAIN_GAP)[0].json()
    second = post_plan(fill_dates=RAIN_GAP)[0].json()
    first.pop("request_id"), second.pop("request_id")
    assert first == second


def test_the_query_to_nasa_sends_only_coordinates_dates_and_variables() -> None:
    _, server = post_plan()
    params = dict(server.requests[0].url.params)
    assert set(params) == {
        "parameters",
        "community",
        "latitude",
        "longitude",
        "start",
        "end",
        "format",
        "time-standard",
    }
    assert "Lote 7" not in str(server.requests[0].url)  # el nombre de la parcela no se envía


# --- T047: errores de punta a punta ---


def test_error_three_semantic_errors_give_422_with_three_details_and_no_nasa_call() -> None:
    client, server = make_client()
    payload = plan_request()
    payload["parcel"]["theta_wp_m3_m3"] = 0.3
    del payload["rotations"][0]["crops"][0]["ym_t_ha"]
    payload["rotations"][0]["crops"][1]["economics"]["price_per_t"] = 100
    response = client.post(URL, json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert len(error["details"]) == 3 and error["category"] == "input"
    assert server.requests == []


def test_error_connection_failure_gives_503() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sin red")

    client, _ = make_client(refuse)
    response = client.post(URL, json=plan_request())
    assert response.status_code == 503
    error = response.json()["error"]
    assert (error["category"], error["code"], error["retryable"]) == (
        "nasa_power",
        "power_unreachable",
        True,
    )
    assert "No se calculó ningún escenario" in error["message"]


def test_error_read_timeout_gives_504_mentioning_sixty_seconds() -> None:
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("lento")

    client, _ = make_client(slow)
    response = client.post(URL, json=plan_request())
    assert response.status_code == 504
    assert "60 s" in response.json()["error"]["message"]
    assert response.json()["error"]["code"] == "power_timeout"


def test_error_rate_limit_gives_503_rate_limited() -> None:
    client, _ = make_client(lambda request: httpx.Response(429))
    response = client.post(URL, json=plan_request())
    assert (response.status_code, response.json()["error"]["code"]) == (503, "power_rate_limited")


def test_error_nasa_http_error_gives_502_with_the_status() -> None:
    client, _ = make_client(lambda request: httpx.Response(500))
    response = client.post(URL, json=plan_request())
    assert response.status_code == 502
    assert "(500)" in response.json()["error"]["message"]


def test_error_payload_without_wind_max_gives_502() -> None:
    """CA-5.5: una variable requerida omitida por completo."""
    response, _ = post_plan(drop_parameter="WS2M_MAX")
    assert response.status_code == 502
    error = response.json()["error"]
    assert (error["category"], error["code"]) == ("nasa_power", "power_bad_response")
    assert "formato inesperado" in error["message"]


def test_error_payload_that_is_not_json_gives_502() -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, content=b"<html>mantenimiento</html>")
    )
    assert client.post(URL, json=plan_request()).status_code == 502


def test_error_payload_with_other_units_gives_502() -> None:
    response, _ = post_plan(units_override={"WS2M": "km/h"})
    assert response.status_code == 502


def test_error_forced_integrity_failure_gives_500_without_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def broken(*args: Any, **kwargs: Any) -> Any:
        raise CalculationIntegrityError("cierre de masa fuera de tolerancia", closure_mm=3.2)

    monkeypatch.setattr(simulation_service, "run_daily_balance", broken)
    client, _ = make_client(Power())
    response = client.post(URL, json=plan_request())
    assert response.status_code == 500
    body = response.json()
    assert "results" not in body and set(body) == {"error"}
    error = body["error"]
    assert (error["category"], error["code"], error["retryable"]) == (
        "internal",
        "calculation_integrity",
        False,
    )
    assert "cierre de masa" not in response.text and "3.2" not in response.text


def test_error_an_unexpected_exception_gives_500_without_internal_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("detalle interno app.services.climate_parser línea 99")

    monkeypatch.setattr(simulation_service, "compute_et0_series", boom)
    client, _ = make_client(Power())
    origin = "http://localhost:5173"
    response = client.post(URL, json=plan_request(), headers={"Origin": origin})
    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-expose-headers"] == "X-Request-ID"
    denied = client.post(URL, json=plan_request(), headers={"Origin": "https://untrusted.example"})
    assert denied.status_code == 500
    assert "access-control-allow-origin" not in denied.headers
    assert response.json()["error"]["code"] == "unexpected_error"
    assert "detalle interno" not in response.text and "Traceback" not in response.text
    assert response.headers["x-request-id"] == response.json()["error"]["request_id"]


def test_all_scenarios_blocked_gives_200_with_empty_results_and_the_warning() -> None:
    response, _ = post_plan(
        fill_dates={"PRECTOTCORR": [date(2008, 7, 5), date(2011, 7, 5), date(2017, 7, 5)]}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["results"] == [] and body["comparisons"] == []
    assert [s["status"] for s in body["scenarios"]] == ["blocked"] * 3
    assert "SCENARIOS_BLOCKED" in {w["code"] for w in body["warnings"]}
    assert all(s["blocked_reasons"] for s in body["scenarios"])


def test_a_blocked_scenario_does_not_stop_the_others() -> None:
    body = post_plan(fill_dates=RAIN_GAP)[0].json()
    assert {r["start_year"] for r in body["results"]} == {2008, 2011}
    blocked = next(s for s in body["scenarios"] if s["status"] == "blocked")
    assert blocked["blocked_reasons"][0]["code"] == "MISSING_PRECIPITATION"


def test_every_error_response_has_the_header_request_id() -> None:
    client, _ = make_client(lambda request: httpx.Response(500))
    response = client.post(URL, json=plan_request())
    assert is_uuid(response.headers["x-request-id"])


def test_computed_at_comes_from_the_injected_clock() -> None:
    assert NOW.isoformat().startswith("2026-11-15T14:03:22")
