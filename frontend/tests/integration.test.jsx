import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError, errorSummary, getCatalog, getHealth, postSimulation } from "../src/services/api.js";
import { rotations } from "../src/data/demo.js";
import { parcels } from "../src/data/parcels.js";
import { economicSummary } from "../src/workspaces/economics.js";
import { buildSimulationRequestPayload, contractStrategyMap, demoPreparation, rootDepthMeters, simulationRequestIssues } from "../src/workspaces/preparation.js";
import { buildReportPayload, ReportContent } from "../src/workspaces/ReportWorkspace.jsx";
import { emptyDraft, exportDraft, parcelWithIdentity } from "../src/workspaces/session.js";
import { DEMO_LABEL, simulationContext, simulationStatus } from "../src/workspaces/simulation.js";
import SimulationResults, { CostAssignment, RUN_PROMPT, SimulationError, StrategyEngineSummary } from "../src/workspaces/SimulationResults.jsx";
import EconomyWorkspace from "../src/workspaces/EconomyWorkspace.jsx";
import EconomicExplorer from "../src/workspaces/EconomicExplorer.jsx";
import InterpretationWorkspace from "../src/workspaces/InterpretationWorkspace.jsx";
import PreparationReview, { preparationRows } from "../src/workspaces/PreparationReview.jsx";
import StrategyComparison from "../src/workspaces/strategies/StrategyComparison.jsx";
import { duplicateStrategy, saveStrategy, strategyTemplates } from "../src/workspaces/strategies/model.js";

const backend = new URL("../../backend/", import.meta.url);
const openapi = JSON.parse(readFileSync(new URL("tests/snapshots/openapi_v1.json", backend), "utf8"));
const exampleResponse = JSON.parse(readFileSync(new URL("app/data/examples/simulation_response.json", backend), "utf8"));

// Minimal JSON Schema check against the OpenAPI snapshot of the contract 1.0 (no extra dependency).
function schemaErrors(value, schema, path = "$") {
  if (schema.$ref) return schemaErrors(value, openapi.components.schemas[schema.$ref.split("/").at(-1)], path);
  if (schema.anyOf) return schema.anyOf.some((option) => !schemaErrors(value, option, path).length) ? [] : [`${path}: no option of anyOf matches ${JSON.stringify(value)}`];
  const errors = [];
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const matches = { integer: Number.isInteger(value), number: kind === "number" }[schema.type] ?? (!schema.type || kind === schema.type);
  if (!matches) return [`${path}: expected ${schema.type}, received ${kind}`];
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: const`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: enum`);
  if (kind === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: exclusiveMinimum`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${path}: exclusiveMaximum`);
  }
  if (kind === "string") {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: maxLength`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: minLength`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern`);
  }
  if (kind === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: maxItems`);
    value.forEach((item, index) => errors.push(...schemaErrors(item, schema.items ?? {}, `${path}[${index}]`)));
  }
  if (kind === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...schemaErrors(item, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown field`);
    }
  }
  return errors;
}
const requestSchema = { $ref: "#/components/schemas/SimulationRequest" };

const referenceParcel = parcels[1];
const parcel = parcelWithIdentity(referenceParcel, {});
const templates = strategyTemplates(rotations, parcel);
const demoDraft = { ...emptyDraft, ...demoPreparation(emptyDraft) };
const preparation = (draft, strategies) => ({ identity: draft.identity, soil: draft.soil, historical: draft.historical, strategies });
const build = (draft = demoDraft, strategies = templates) =>
  buildSimulationRequestPayload(parcel, preparation(draft, strategies), economicSummary(draft, strategies));

describe("Contract 1.0 request", () => {
  it("the OpenAPI snapshot is the contract 1.0 and the checker rejects a broken request", () => {
    expect(openapi.paths).toHaveProperty("/api/v1/simulations");
    expect(schemaErrors({ parcel: {}, rotations: [] }, requestSchema).length).toBeGreaterThan(0);
    expect(schemaErrors({ ...build(), surprise: 1 }, requestSchema)).toEqual(["$.surprise: unknown field"]);
  });

  it("builds a valid request for the three demonstration templates without blocking issues", () => {
    const request = build();
    expect(simulationRequestIssues(preparation(demoDraft, templates))).toEqual([]);
    expect(schemaErrors(request, requestSchema)).toEqual([]);
    expect(request.parcel).toEqual({ name: "Parcela Central", latitude_deg: -33.68, longitude_deg: -65.47, theta_fc_m3_m3: 0.28,
      theta_wp_m3_m3: 0.12, effective_depth_m: 1.2, initial_available_water_pct: 50, fallow_kc_base: null });
    expect(request.window).toEqual({ start_day: 1, start_month: 7, start_years: [2008, 2011, 2017] });
    expect(request.currency).toBe("USD");
    expect(request.rotations.map(({ id, crops }) => [id, crops.map(({ crop_code: code }) => code)])).toEqual([
      ["A", ["maize", "soybean_first"]], ["B", ["maize", "rye_cover", "soybean_first"]], ["C", ["maize", "wheat", "soybean_second"]]]);
  });

  it("sends fallows implicitly, empty advanced parameters as null and omits undeclared residue", () => {
    const [rotationA, rotationB, rotationC] = build().rotations;
    expect(rotationA).not.toHaveProperty("initial_residue_cover_pct");
    expect(rotationA.crops[0]).toMatchObject({ sowing: { window_year: 1, day: 15, month: 10 }, stage_lengths_days: null, kc_initial: null, kc_mid: null,
      kc_end: null, root_depth_initial_m: null, root_depth_max_m: null, depletion_fraction_p: null, ky: null, ym_t_ha: 9, residue_cover_after_pct: 60,
      economics: { price_per_t: 180, direct_costs_per_ha: 620 } });
    const rye = rotationB.crops[1];
    expect(rye.stage_lengths_days).toEqual({ initial: 20, development: 40, mid: 40, late: 20 });
    expect(rye.economics).toEqual({ direct_costs_per_ha: 95 });
    expect(rye).not.toHaveProperty("ym_t_ha");
    expect(rye).not.toHaveProperty("ky");
    expect(rotationC.crops[1]).not.toHaveProperty("residue_cover_after_pct");
  });

  it("maps up to three library strategies to A, B and C keeping their own identifiers", () => {
    let count = 0;
    const custom = saveStrategy({ ...duplicateStrategy(templates[2], () => `custom-${++count}`), name: "Doble cultivo propio", initialResidue: { value: "35", unit: "%" } });
    const selected = [custom, templates[0]];
    expect(contractStrategyMap(selected)).toEqual({ A: custom.id, B: "A" });
    const draft = { ...demoDraft, costs: [...demoDraft.costs, { id: "own", strategy: custom.id, crop: "Trigo", amount: "400", currency: "USD", unit: "USD/ha" }] };
    const request = build(draft, selected);
    expect(schemaErrors(request, requestSchema)).toEqual([]);
    expect(request.rotations.map(({ id, name }) => [id, name])).toEqual([["A", "Doble cultivo propio"], ["B", "Barbecho"]]);
    expect(request.rotations[0].initial_residue_cover_pct).toBe(35);
    expect(request.rotations[0].crops.map(({ economics }) => economics.direct_costs_per_ha)).toEqual([null, 400, null]);
    expect(contractStrategyMap([...templates, custom])).toEqual({ A: "A", B: "B", C: "C" });
  });

  it("converts root depths from centimetres to metres and passes declared parameters through", () => {
    expect(rootDepthMeters({ value: "120", unit: "cm" })).toBe(1.2);
    expect(rootDepthMeters({ value: "150", unit: "m" })).toBe(1.5);
    expect(rootDepthMeters({ value: "0,9", unit: "m" })).toBe(0.9);
    expect(rootDepthMeters({ value: "", unit: "cm" })).toBeNull();
    const stage = { ...templates[0].stages[0], agronomy: { ...templates[0].stages[0].agronomy,
      durations: { initial: "30", development: "40", mid: "50", late: "30" },
      advanced: { kc_mid: { value: "1,15", unit: "adimensional" }, ky: { value: "", unit: "" },
        root_depth_initial_m: { value: "25", unit: "cm" }, root_depth_max_m: { value: "1.4", unit: "m" } } } };
    const request = build(demoDraft, [{ ...templates[0], stages: [stage, ...templates[0].stages.slice(1)] }]);
    expect(schemaErrors(request, requestSchema)).toEqual([]);
    expect(request.rotations[0].crops[0]).toMatchObject({ kc_mid: 1.15, ky: null, kc_initial: null, root_depth_initial_m: 0.25, root_depth_max_m: 1.4,
      stage_lengths_days: { initial: 30, development: 40, mid: 50, late: 30 } });
  });

  it("leaves economics in null when a price or cost is missing or currencies are mixed", () => {
    const noWheat = { ...demoDraft, prices: demoDraft.prices.filter(({ crop }) => crop !== "Trigo"), costs: demoDraft.costs.filter(({ id }) => id !== "demo-cost-C-Maíz") };
    const partial = build(noWheat);
    expect(partial.currency).toBe("USD");
    expect(partial.rotations[2].crops.map(({ economics }) => economics)).toEqual([
      { price_per_t: 180, direct_costs_per_ha: null }, { price_per_t: null, direct_costs_per_ha: 420 }, { price_per_t: 300, direct_costs_per_ha: 300 }]);
    const mixed = { ...demoDraft, prices: demoDraft.prices.map((row) => row.crop === "Soja" ? { ...row, currency: "ARS" } : row) };
    const summary = economicSummary(mixed, templates);
    expect(summary).toMatchObject({ incompatible: true, currency: null, currencies: ["ARS", "USD"] });
    const request = build(mixed);
    expect(request.currency).toBeNull();
    expect(request.rotations.flatMap(({ crops }) => crops.flatMap(({ economics }) => Object.values(economics))).every((value) => value === null)).toBe(true);
    expect(schemaErrors(request, requestSchema)).toEqual([]);
    const empty = build({ ...demoDraft, prices: [], costs: [] });
    expect(empty.currency).toBeNull();
    expect(schemaErrors(empty, requestSchema)).toEqual([]);
  });

  it("adds per-hectare cost rows of a stage and reports rows it cannot assign", () => {
    const draft = { ...demoDraft, costs: [...demoDraft.costs,
      { id: "seed", strategy: "A", crop: "maíz", amount: "30,5", currency: "USD", unit: "ha" },
      { id: "total", strategy: "A", crop: "Maíz", amount: "900", currency: "USD", unit: "USD/lote" },
      { id: "nowhere", strategy: "A", crop: "Girasol", amount: "10", currency: "USD", unit: "USD/ha" }] };
    const summary = economicSummary(draft, templates);
    expect(summary.stages.A["A-0"]).toEqual({ pricePerT: 180, costPerHa: 650.5 });
    expect(summary.assignedCosts.filter(({ stageId }) => stageId === "A-0").map(({ id }) => id)).toEqual(["demo-cost-A-Maíz", "seed"]);
    expect(summary.unassignedCosts.map(({ id }) => id)).toEqual(["total", "nowhere"]);
  });

  it("explains why each cost row is left out of the request", () => {
    let count = 0;
    const custom = saveStrategy({ ...duplicateStrategy(templates[2], () => `other-${++count}`), name: "Fuera de la mesa" });
    const twoSoy = { ...templates[0], stages: [...templates[0].stages, { ...templates[0].stages[2], id: "A-3" }] };
    const cost = (id, fields) => ({ id, strategy: "A", crop: "Maíz", amount: "100", currency: "USD", unit: "USD/ha", ...fields });
    const draft = { ...demoDraft, costs: [cost("ok"), cost("lot", { unit: "USD/lote" }), cost("crop", { crop: "Girasol" }), cost("soy", { crop: "Soja" }),
      cost("money", { amount: "" }), cost("none", { strategy: "" }), cost("away", { strategy: custom.id }), { id: "blank" }] };
    const summary = economicSummary(draft, [twoSoy, templates[1]]);
    expect(summary.assignedCosts).toEqual([{ id: "ok", label: "Maíz", strategyId: "A", strategyName: "Barbecho", amount: "100 USD/ha", stageId: "A-0", stageName: "Maíz" }]);
    expect(Object.fromEntries(summary.unassignedCosts.map(({ id, reason }) => [id, reason]))).toEqual({
      none: "Sin estrategia asignada.",
      away: "La estrategia no está en la mesa comparativa.",
      lot: "Unidad distinta de por hectárea (USD/lote). Convertí el costo a USD/ha.",
      crop: "Sin cultivo u operación vinculada a un cultivo de la estrategia.",
      soy: "Coincide con más de un cultivo de la estrategia. Vinculá una operación.",
      money: "Entrada incompleta o inválida: Indicá el importe.",
    });
    expect(summary.stages.A["A-0"].costPerHa).toBe(100);
    const request = buildSimulationRequestPayload(parcel, preparation(draft, [twoSoy, templates[1]]), summary);
    expect(request.rotations[0].crops.map(({ economics }) => economics.direct_costs_per_ha)).toEqual([100, null, null]);
    const html = renderToStaticMarkup(<CostAssignment economy={summary} />);
    for (const { reason } of summary.unassignedCosts) expect(html).toContain(reason);
    expect(html).toContain("6 costo(s) declarado(s) no entran al cálculo");
    expect(html).toContain("Costos que entran al cálculo");
    const oneOut = { ...demoDraft, costs: [...demoDraft.costs, cost("crop", { crop: "Girasol" })] };
    expect(preparationRows(oneOut, economicSummary(oneOut, templates)).at(-1)[2]).toBe("1 costo(s) fuera del cálculo · Revisar vínculo o unidad");
    expect(preparationRows(demoDraft, economicSummary(demoDraft, templates)).at(-1)[2]).toBe("Entradas registradas · 8 costo(s) entran al cálculo");
    expect(renderToStaticMarkup(<PreparationReview draft={draft} economy={summary} />)).toContain("Costos fuera del cálculo");
    expect(renderToStaticMarkup(<CostAssignment economy={economicSummary(demoDraft, templates)} />)).not.toContain("no entran al cálculo");
  });

  it("lists what is missing before calling the service", () => {
    const issues = simulationRequestIssues(preparation(emptyDraft, []));
    expect(issues.map(({ where }) => where)).toEqual(expect.arrayContaining(["Mi parcela · Identificación", "Mi parcela · Caracterización del suelo",
      "Explorar estrategias · Clima histórico", "Mesa comparativa"]));
    const custom = { ...templates[0], name: "Sorgo", stages: [{ id: "s", kind: "commercial", cropId: "custom", customCropName: "Sorgo", operations: [] }] };
    expect(simulationRequestIssues(preparation(demoDraft, [custom])).map(({ message }) => message)).toEqual(["Sin modelo disponible para esta especie."]);
  });
});

describe("Run state", () => {
  const context = simulationContext({ parcel, draft: demoDraft, strategies: templates, comparisonIds: ["A", "B", "C"] });
  const run = { status: "done", request: context.request, strategyMap: context.strategyMap, response: exampleResponse, error: null, executedAt: "2026-11-15T12:00:00.000Z" };

  it("marks the run as stale after any edit of soil, window, strategies or economy", () => {
    expect(context.status).toBe("none");
    expect(simulationStatus(run, context.request)).toBe("current");
    const edits = [
      { soil: { ...demoDraft.soil, depth: { ...demoDraft.soil.depth, value: "1.0" } } },
      { historical: { ...demoDraft.historical, start_years: [2008] } },
      { prices: demoDraft.prices.map((row) => ({ ...row, amount: "210" })) },
      { comparisonIds: ["A", "C"] },
    ];
    for (const { comparisonIds = ["A", "B", "C"], ...edit } of edits) {
      const edited = simulationContext({ parcel, draft: { ...demoDraft, ...edit, simulationRun: run }, strategies: templates, comparisonIds });
      expect(edited.status).toBe("stale");
      expect(edited.response).toBe(exampleResponse);
    }
    expect(simulationStatus({ ...run, status: "running" }, context.request)).toBe("running");
    expect(simulationStatus({ ...run, status: "error" }, context.request)).toBe("error");
  });

  it("shows the real ranges, scenarios, comparisons, assumptions and provenance of the response", () => {
    const html = renderToStaticMarkup(<SimulationResults run={run} status="current" strategies={templates} />);
    expect(html).toContain(`Contrato ${exampleResponse.contract_version}`);
    expect(html).toContain("A · Barbecho");
    expect(html).toContain("Cierre de masa (mm)");
    expect(html).toContain(exampleResponse.ranges[0].label);
    expect(html).toContain(exampleResponse.provenance.label);
    for (const { code } of [...exampleResponse.warnings, ...exampleResponse.assumptions]) expect(html).toContain(code);
    expect(html).not.toContain(DEMO_LABEL);
    const inspector = renderToStaticMarkup(<StrategyEngineSummary simulation={{ run, response: exampleResponse, status: "stale" }} strategy={templates[0]} />);
    expect(inspector).toContain("Resultados del motor · rotación A");
    expect(inspector).toContain("Desactualizada (pendiente de recalcular)");
  });

  it("keeps the demonstration clearly labelled until the engine is run", () => {
    const demoResults = rotations.map((rotation) => ({ ...rotation, ...referenceParcel.scenarios[rotation.id] }));
    const props = { strategies: templates, comparisonIds: ["A", "B", "C"], inspection: { strategyId: "A" }, demoResults, scenario: "Histórico · ejemplo", draft: demoDraft };
    const before = renderToStaticMarkup(<StrategyComparison {...props} simulation={context} />);
    expect(before).toContain("Ejecutar simulación (NASA POWER)");
    expect(before).toContain(DEMO_LABEL);
    expect(before).toContain("Sin ejecutar");
    const after = renderToStaticMarkup(<StrategyComparison {...props} simulation={{ ...context, run, response: exampleResponse, status: "current" }} />);
    expect(after).toContain("Resultados del motor vigentes");
    expect(after).not.toContain(DEMO_LABEL);
    expect(after).not.toContain("660.000");
  });

  it("shows the backend error with its request id and field details", () => {
    const error = { status: 422, message: "La solicitud tiene datos inválidos.", requestId: "req-123", retryable: false,
      details: [{ field: "rotations[0].crops[1].ym_t_ha", message: "Falta este campo obligatorio." }] };
    const html = renderToStaticMarkup(<SimulationError error={error} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("HTTP 422");
    expect(html).toContain("req-123");
    expect(html).toContain("rotations[0].crops[1].ym_t_ha");
    expect(html).toContain("Falta este campo obligatorio.");
  });

  it("exports the session file with the exact contract request and the engine response", () => {
    const props = { parcel, referenceParcel, strategies: templates, comparisonIds: ["A", "B", "C"], selected: templates[0], scenario: "Histórico · ejemplo",
      parcelRotations: rotations.map((rotation) => ({ ...rotation, ...referenceParcel.scenarios[rotation.id] })) };
    const pending = buildReportPayload({ ...props, draft: demoDraft });
    expect(pending.contractRequest).toEqual(context.request);
    expect(pending).toMatchObject({ contractVersion: "1.0", contractStrategyMap: { A: "A", B: "B", C: "C" }, simulationResponse: null, simulationStatus: "Sin ejecutar" });
    const executed = buildReportPayload({ ...props, draft: { ...demoDraft, simulationRun: run } });
    expect(executed.simulationResponse).toBe(exampleResponse);
    expect(executed.declared).not.toHaveProperty("simulationRun");
    expect(exportDraft({ ...demoDraft, simulationRun: run })).not.toHaveProperty("simulationRun");
    const report = renderToStaticMarkup(<ReportContent {...props} draft={{ ...demoDraft, simulationRun: run }} />);
    expect(report).toContain("Resultados del motor");
    expect(report).not.toContain("Referencia de ejemplo");
  });
});

describe("Economy and interpretation with the engine", () => {
  const draft = { ...demoDraft, costs: [...demoDraft.costs, { id: "lot", strategy: "A", crop: "Maíz", amount: "900", currency: "USD", unit: "USD/lote" }] };
  const context = simulationContext({ parcel, draft, strategies: templates, comparisonIds: ["A", "B", "C"] });
  const run = { status: "done", request: context.request, strategyMap: context.strategyMap, response: exampleResponse, error: null, executedAt: "2026-11-15T12:00:00.000Z" };
  const executed = { ...context, run, response: exampleResponse, status: "current" };
  const demoResults = rotations.map((rotation) => ({ ...rotation, ...referenceParcel.scenarios[rotation.id] }));
  const actions = { onRun: () => {}, onLoadDemo: () => {}, onCheckService: () => {} };
  const props = (simulation) => ({ draft, patch: () => {}, parcel, scenario: "Histórico · ejemplo", parcelRotations: demoResults, selectedId: "A",
    strategies: templates, strategyBook: { strategies: templates }, engine: { simulation, ...actions } });
  const economy = (section, simulation) => renderToStaticMarkup(<EconomyWorkspace section={section} {...props(simulation)} />);
  const interpretation = (section, simulation) => renderToStaticMarkup(<InterpretationWorkspace section={section} {...props(simulation)} />);
  const stale = /requiere[n]? cálculo|FastAPI|[Pp]endiente de integración|pendientes de cálculo|no disponibles|PROTOTIPO/;

  it("asks to run the simulation, with the quick access, before there are results", () => {
    for (const html of [economy("comparacion", context), interpretation("resultados", context), interpretation("advertencias", context), interpretation("procedencia", context)]) {
      expect(html).toContain(RUN_PROMPT);
      expect(html).toContain("Ejecutar simulación (NASA POWER)");
      expect(html).toContain("Cargar entradas de ejemplo");
      expect(html).not.toMatch(stale);
    }
    expect(economy("comparacion", context)).toContain(DEMO_LABEL);
  });

  it("shows income, direct costs, margins, ranges and differences returned by the backend", () => {
    const html = economy("comparacion", executed);
    expect(html).not.toContain(RUN_PROMPT);
    expect(html).not.toContain(DEMO_LABEL);
    expect(html).not.toContain("600.000");
    for (const caption of ["Rango del margen bruto por rotación (USD/ha)", "Economía por rotación y escenario histórico (USD/ha)",
      "Economía por cultivo y escenario histórico (USD/ha)", "Diferencias de margen bruto entre rotaciones (USD/ha)"]) expect(html).toContain(caption);
    expect(html).toContain(exampleResponse.comparisons[0].label);
    expect(html).toContain("1 costo(s) declarado(s) no entran al cálculo");
    expect(html).toContain("Unidad distinta de por hectárea (USD/lote)");
    expect(html).not.toMatch(stale);
  });

  it("reports a margin that the backend did not compute, with its note", () => {
    const response = structuredClone(exampleResponse);
    const [result] = response.results;
    Object.assign(result.rotation_economics, { status: "not_computed", income_per_ha: null, direct_costs_per_ha: null, gross_margin_per_ha: null,
      crops_missing_economics: [{ position: 1, crop_code: result.crops[0].crop_code, missing_fields: ["price_per_t"], reason: "Falta el precio del cultivo." }] });
    result.crops[0].economics = { status: "not_computed", income_per_ha: null, direct_costs_per_ha: null, gross_margin_per_ha: null,
      missing_fields: ["price_per_t"], reason: "missing_economic_data", note: "Falta el precio del cultivo." };
    const html = economy("comparacion", { ...executed, run: { ...run, response }, response });
    expect(html).toContain("No calculado (not_computed)");
    expect(html).toContain("Falta el precio del cultivo.");
    expect(html).toContain("price_per_t");
  });

  it("warns that the results are stale and offers to recalculate", () => {
    const html = economy("comparacion", { ...executed, status: "stale" });
    expect(html).toContain("Desactualizada (pendiente de recalcular)");
    expect(html).toContain("Ejecutar simulación (NASA POWER)");
    expect(html).toContain("Economía por rotación y escenario histórico (USD/ha)");
  });

  it("lists the cost assignment next to the cost entries and in the explorer", () => {
    expect(economy("costos", context)).toContain("Costos fuera del cálculo");
    const explorer = renderToStaticMarkup(<EconomicExplorer parcel={parcel} scenario="Histórico · ejemplo" selected={templates[0]} strategies={templates} draft={draft}
      baseline={{ prices: draft.prices, costs: draft.costs }} patch={() => {}} onClose={() => {}} engine={{ simulation: executed, ...actions }} />);
    expect(explorer).toContain("Rango del margen bruto por rotación (USD/ha)");
    expect(explorer).toContain("Unidad distinta de por hectárea (USD/lote)");
    expect(explorer).not.toMatch(stale);
  });

  it("shows the findings of the engine: water balance, stress, wind exposure, warnings, assumptions and provenance", () => {
    const findings = interpretation("resultados", executed);
    for (const caption of ["Balance hídrico del perfil por rotación y escenario (mm)", "Agua y estrés hídrico por cultivo", "Días con estrés",
      "Exposición del suelo al viento por rotación y escenario (días)"]) expect(findings).toContain(caption);
    expect(findings).toContain(exampleResponse.results[0].soil_exposure.threshold_source);
    for (const { code } of exampleResponse.warnings) expect(findings).toContain(code);
    expect(findings).not.toContain(RUN_PROMPT);
    const warnings = interpretation("advertencias", executed);
    for (const { code } of [...exampleResponse.warnings, ...exampleResponse.assumptions]) expect(warnings).toContain(code);
    const provenance = interpretation("procedencia", executed);
    expect(provenance).toContain(exampleResponse.provenance.label);
    expect(provenance).toContain(`${exampleResponse.assumptions.length} supuestos informados por el motor`);
    for (const html of [findings, warnings, provenance]) expect(html).not.toMatch(stale);
  });
});

describe("API client", () => {
  const reply = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (name) => headers[name] ?? null } });
  const calls = [];
  const fetchWith = (response) => async (url, init) => { calls.push([url, init]); return response; };

  it("reads health, catalog and simulations from the configured base", async () => {
    calls.length = 0;
    const options = { baseUrl: "http://localhost:8000/api/v1", fetchImpl: fetchWith(reply(200, { status: "ok" })) };
    await expect(getHealth(options)).resolves.toEqual({ status: "ok" });
    await getCatalog(options);
    await postSimulation({ rotations: [] }, options);
    expect(calls.map(([url, { method }]) => `${method} ${url}`)).toEqual(["GET http://localhost:8000/api/v1/health",
      "GET http://localhost:8000/api/v1/catalog", "POST http://localhost:8000/api/v1/simulations"]);
    expect(calls[2][1]).toMatchObject({ body: '{"rotations":[]}', headers: { "Content-Type": "application/json" } });
  });

  it.each([[422, "input", false], [502, "nasa_power", true], [503, "nasa_power", true], [504, "nasa_power", true], [500, "internal", false]])(
    "turns a %i envelope into a structured error", async (status, category, retryable) => {
      const envelope = { error: { category, code: "some_code", message: "Mensaje del backend.", retryable, request_id: "req-9",
        details: status === 422 ? [{ field: "parcel.latitude_deg", message: "Fuera de rango.", code: "out_of_range" }] : null } };
      const error = await postSimulation({}, { fetchImpl: fetchWith(reply(status, envelope)) }).catch((caught) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect(errorSummary(error)).toEqual({ status, category, code: "some_code", message: "Mensaje del backend.", retryable, requestId: "req-9",
        details: status === 422 ? [{ field: "parcel.latitude_deg", message: "Fuera de rango.", code: "out_of_range" }] : [] });
    });

  it("explains a network failure and an unexpected body in Spanish", async () => {
    const offline = await getHealth({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }).catch((caught) => caught);
    expect(errorSummary(offline)).toMatchObject({ status: 0, category: "network", retryable: true, requestId: null });
    expect(offline.message).toContain("No se pudo conectar con el servicio de cálculo");
    const html = await getHealth({ fetchImpl: fetchWith({ ok: false, status: 502, json: async () => { throw new SyntaxError("html"); }, headers: { get: () => "req-proxy" } }) }).catch((caught) => caught);
    expect(errorSummary(html)).toMatchObject({ status: 502, retryable: true, requestId: "req-proxy" });
    expect(errorSummary(new Error("boom")).message).toContain("error inesperado");
  });
});
