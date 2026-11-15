// Session state of a run of the backend engine. Formatting and lookups only: every figure shown
// comes from the response of POST /api/v1/simulations.
import { selectedStrategies } from "./comparison.js";
import { economicSummary } from "./economics.js";
import { buildSimulationRequestPayload, contractStrategyMap, demoPreparation, simulationRequestIssues } from "./preparation.js";

import { emptyDraft } from "./session.js";
import { initialComparison } from "./strategies/model.js";

export const DEMO_LABEL = "Datos de ejemplo (sin ejecutar motor)";
export const STATUS_LABELS = {
  none: "Sin ejecutar",
  running: "Solicitud enviada al motor · Consulta de NASA POWER…",
  current: "Resultados del motor vigentes",
  stale: "Desactualizada (pendiente de recalcular)",
  error: "La última ejecución no se completó",
};

/** Request, strategy map and state of the run for the strategies of the comparison. */
export function simulationContext({ parcel, draft, strategies, comparisonIds }) {
  const compared = selectedStrategies(strategies, comparisonIds);
  const preparation = { identity: draft.identity, soil: draft.soil, historical: draft.historical ?? {}, strategies: compared };
  const economy = economicSummary(draft, compared);
  const request = buildSimulationRequestPayload(parcel, preparation, economy);
  const run = draft.simulationRun ?? null;
  const hasInputs = Object.values(draft.identity).some(Boolean)
    || Object.values(draft.soil).some((row) => Object.values(row ?? {}).some(Boolean))
    || Object.values(draft.historical ?? {}).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value))
    || draft.prices.length > 0 || draft.costs.length > 0 || comparisonIds.join() !== initialComparison.join();
  return { request, hasInputs, strategyMap: contractStrategyMap(compared), issues: simulationRequestIssues(preparation), economy, run,
    status: simulationStatus(run, request), response: run?.response ?? null };
}

export function exampleSimulation({ parcel, draft, strategies }, confirmReplace) {
  const current = simulationContext({
    parcel, draft, strategies, comparisonIds: draft.comparisonIds ?? initialComparison,
  });
  if (current.hasInputs && !confirmReplace()) return null;

  const example = demoPreparation(emptyDraft);
  const { fallowKc: _fallowKc, ...soil } = draft.soil;
  const changes = {
    ...example,
    identity: { ...draft.identity, ...example.identity },
    soil: { ...soil, ...example.soil },
    comparisonIds: initialComparison,
  };
  const context = simulationContext({
    parcel, draft: { ...draft, ...changes }, strategies, comparisonIds: initialComparison,
  });
  return { context, changes };
}

export function startSimulation({ parcelId, context, run, save, changes, example }) {
  if (context.issues.length || context.status === "running") return;
  const { request, strategyMap } = context;
  return run(parcelId, request, (state) => save({
    ...(state.phase === "connecting" ? changes : {}),
    simulationRun: { request, strategyMap, example, response: null, error: null, executedAt: null, ...state },
  }));
}

/** `stale` when soil, window, strategies or economy changed after the run. */
export function simulationStatus(run, request) {
  if (!run) return "none";
  if (run.status === "running") return "running";
  if (JSON.stringify(run.request) !== JSON.stringify(request)) return "stale";
  return run.status === "error" ? "error" : "current";
}

/** Contract id (`A`, `B`, `C`) that a strategy of the library had in the run. */
export function rotationIdOf(run, strategyId) {
  return Object.entries(run?.strategyMap ?? {}).find(([, id]) => id === strategyId)?.[0];
}

export function rotationLabel(run, strategies, rotationId) {
  const name = strategies?.find(({ id }) => id === run?.strategyMap?.[rotationId])?.name
    ?? run?.response?.resolved_input.rotations.find(({ id }) => id === rotationId)?.name;
  return name ? `${rotationId} · ${name}` : rotationId;
}

export function cropName(response, rotationId, position) {
  return response.resolved_input.rotations.find(({ id }) => id === rotationId)?.crops
    .find((crop) => crop.position === position)?.crop_name ?? `Cultivo ${position}`;
}

const formatters = new Map();
export function formatValue(value, digits = 1) {
  if (value === null || value === undefined) return "Sin dato";
  if (!formatters.has(digits)) formatters.set(digits, new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: digits }));
  return formatters.get(digits).format(value);
}

/** «mín · mediana · máx» of a descriptive range of the response. */
export function rangeText(range, digits = 1) {
  if (!range) return "No calculado";
  const text = [range.min, range.median, range.max].map((value) => formatValue(value, digits)).join(" · ");
  return range.no_range ? `${text} (un solo escenario)` : text;
}

export function moneyUnit(response) {
  return `${response.currency ?? "moneda sin declarar"}/ha`;
}
