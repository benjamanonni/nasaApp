import { DEMO_SOURCE, stageName } from "./strategies/model.js";

export function numberValue(value) {
  const text = String(value ?? "").trim();
  return /^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : null;
}
export function rangeError(value, min, max, exclusiveMin = false, exclusiveMax = false) {
  const n = numberValue(value);
  if (n === null) return "Ingresá un valor numérico.";
  return (exclusiveMin ? n <= min : n < min) || (exclusiveMax ? n >= max : n > max)
    ? "Valor fuera del rango permitido." : undefined;
}
export const soilDefinitions = [
  ["fieldCapacity", "Capacidad de campo", "m³/m³", 0, 1, true],
  ["wiltingPoint", "Punto de marchitez permanente", "m³/m³", 0, 1, false, true],
  ["depth", "Profundidad efectiva", "m", 0, 3, true],
  ["availableWater", "Agua inicialmente disponible", "%", 0, 100],
  ["fallowKc", "Kc base del barbecho", "adimensional", 0, 1, true],
];
export function soilErrors(soil) {
  const errors = {};
  for (const [key, , unit, min, max, exclusiveMin, exclusiveMax] of soilDefinitions) {
    const row = soil[key] ?? {};
    if (key === "fallowKc" && !row.value) continue;
    errors[key] = rangeError(row.value, min, max, exclusiveMin, exclusiveMax);
    if (row.value && row.unit !== unit) errors[key] = "Unidad requerida " + unit + ". Conservá el original y revisá su unidad.";
  }
  const fc = numberValue(soil.fieldCapacity?.value);
  const wp = numberValue(soil.wiltingPoint?.value);
  if (fc !== null && wp !== null && wp >= fc) errors.wiltingPoint = "Debe ser menor que la capacidad de campo.";
  return Object.fromEntries(Object.entries(errors).filter(([, error]) => error));
}
export function recurringDate(day, month) {
  const d = Number(day), m = Number(month);
  return Number.isInteger(d) && Number.isInteger(m) && m >= 1 && m <= 12 && d >= 1 &&
    d <= [31,28,31,30,31,30,31,31,30,31,30,31][m - 1];
}
export function historicalWindows(config = {}, today = new Date().toISOString().slice(0,10)) {
  const errors = {};
  const years = config.start_years ?? [];
  if (!recurringDate(config.start_day, config.start_month)) errors.start_day = "Elegí día y mes válidos. El 29 de febrero no es un inicio recurrente.";
  if (!years.length || years.length > 10) errors.start_years = "Seleccioná entre 1 y 10 años.";
  if (new Set(years.map(Number)).size !== years.length) errors.start_years = "Los años no pueden repetirse.";
  const rows = years.map((year) => {
    if (!/^\d{4}$/.test(String(year)) || Number(year) < 1900 || Number(year) > 2200 || errors.start_day)
      return { year, error: "Fecha o año inválido." };
    const start = new Date(Date.UTC(Number(year), Number(config.start_month)-1, Number(config.start_day)));
    const finish = new Date(Date.UTC(Number(year)+2, Number(config.start_month)-1, Number(config.start_day)-1));
    const end = finish.toISOString().slice(0,10);
    return { year, start: start.toISOString().slice(0,10), end,
      error: end >= today ? "Ventana aún no finalizada." : undefined,
      warning: Number(year) < 1984 ? "Fuera de la cobertura común documentada desde 1984." : undefined };
  });
  return { errors, rows, valid: !Object.keys(errors).length && rows.every(({ error }) => !error) };
}

// --- Contract 1.0 of POST /api/v1/simulations ---------------------------------------------------
// Only maps and converts declared inputs. Nothing agronomic is calculated here: an empty optional
// parameter travels as `null` so the backend applies its reference and records the assumption.

export const CROP_MODEL_MAP = { maize: "maize", "soy-first": "soybean_first", "soy-second": "soybean_second", wheat: "wheat", rye: "rye_cover" };
export const CONTRACT_ROTATION_IDS = ["A", "B", "C"];
export const CONTRACT_VERSION = "1.0";
const COVER_CROP_CODE = "rye_cover";
const DURATION_KEYS = ["initial", "development", "mid", "late"];
const ADVANCED_KEYS = ["kc_initial", "kc_mid", "kc_end", "depletion_fraction_p", "ky"];
const ROOT_KEYS = ["root_depth_initial_m", "root_depth_max_m"];
const MAX_ROOT_DEPTH_M = 3;
const filled = (value) => String(value ?? "").trim() !== "";
const integerValue = (value) => Number.isInteger(numberValue(value)) ? numberValue(value) : null;
const isCropStage = (stage) => stage.kind === "commercial" || stage.kind === "cover";

/** Contract ids in the order of the comparison: `{ A: strategyId, B: strategyId, C: strategyId }`. */
export function contractStrategyMap(strategies = []) {
  return Object.fromEntries(strategies.slice(0, CONTRACT_ROTATION_IDS.length).map(({ id }, index) => [CONTRACT_ROTATION_IDS[index], id]));
}

/** Root depth in metres: a value declared in cm, or greater than 3, is read as centimetres. */
export function rootDepthMeters(entry) {
  const depth = numberValue(entry?.value);
  if (depth === null) return null;
  return entry.unit?.trim().toLowerCase() === "cm" || depth > MAX_ROOT_DEPTH_M ? Number((depth / 100).toFixed(4)) : depth;
}

function soilNumber(soil, key) {
  return soilErrors(soil)[key] ? null : numberValue(soil[key]?.value);
}

function cropPayload(stage, economics) {
  const data = stage.agronomy ?? {};
  const cropCode = CROP_MODEL_MAP[stage.cropId];
  const isCover = cropCode === COVER_CROP_CODE;
  const lengths = DURATION_KEYS.map((key) => integerValue(data.durations?.[key]));
  const crop = {
    crop_code: cropCode,
    sowing: { window_year: integerValue(data.sowing?.window_year), day: integerValue(data.sowing?.day), month: integerValue(data.sowing?.month) },
    stage_lengths_days: lengths.every((days) => days !== null) ? Object.fromEntries(DURATION_KEYS.map((key, index) => [key, lengths[index]])) : null,
  };
  for (const key of ADVANCED_KEYS) if (!(isCover && key === "ky")) crop[key] = numberValue(data.advanced?.[key]?.value);
  for (const key of ROOT_KEYS) crop[key] = rootDepthMeters(data.advanced?.[key]);
  if (!isCover) crop.ym_t_ha = data.ym?.unit === "t/ha" ? numberValue(data.ym.value) : null;
  const residue = numberValue(data.residue?.value);
  if (residue !== null) crop.residue_cover_after_pct = residue;
  const directCosts = economics?.costPerHa ?? null;
  crop.economics = isCover ? { direct_costs_per_ha: directCosts } : { price_per_t: economics?.pricePerT ?? null, direct_costs_per_ha: directCosts };
  return crop;
}

/**
 * Exact body of `POST /api/v1/simulations` for the strategies of the comparison.
 * `preparation` holds the declared `identity`, `soil`, `historical` window and `strategies` (in
 * comparison order); `economicSummary` comes from `economics.js`. Fallows are not sent: the
 * engine infers them from sowing dates and cycle lengths.
 */
export function buildSimulationRequestPayload(parcel, preparation, economicSummary) {
  const { identity = {}, soil = {}, historical = {}, strategies = [] } = preparation;
  return {
    parcel: {
      name: (parcel?.name ?? "").slice(0, 100) || null,
      latitude_deg: numberValue(identity.latitude),
      longitude_deg: numberValue(identity.longitude),
      theta_fc_m3_m3: soilNumber(soil, "fieldCapacity"),
      theta_wp_m3_m3: soilNumber(soil, "wiltingPoint"),
      effective_depth_m: soilNumber(soil, "depth"),
      initial_available_water_pct: soilNumber(soil, "availableWater"),
      fallow_kc_base: filled(soil.fallowKc?.value) ? soilNumber(soil, "fallowKc") : null,
    },
    window: {
      start_day: integerValue(historical.start_day),
      start_month: integerValue(historical.start_month),
      start_years: (historical.start_years ?? []).map(integerValue),
    },
    currency: economicSummary?.currency ?? null,
    rotations: strategies.slice(0, CONTRACT_ROTATION_IDS.length).map((strategy, index) => {
      const residue = numberValue(strategy.initialResidue?.value);
      return {
        id: CONTRACT_ROTATION_IDS[index],
        name: (strategy.name ?? "").slice(0, 100) || null,
        ...(residue === null ? {} : { initial_residue_cover_pct: residue }),
        crops: strategy.stages.filter((stage) => isCropStage(stage) && CROP_MODEL_MAP[stage.cropId])
          .map((stage) => cropPayload(stage, economicSummary?.stages?.[strategy.id]?.[stage.id])),
      };
    }),
  };
}

/**
 * Form completeness before calling the service: what is still missing to build the request.
 * It is not the validation of the model, which belongs to the backend (ranges, calendar, catalog).
 */
export function simulationRequestIssues(preparation) {
  const { identity = {}, soil = {}, historical = {}, strategies = [] } = preparation;
  const issues = [];
  const add = (where, message, href) => issues.push({ where, message, href });
  if (rangeError(identity.latitude, -90, 90) || rangeError(identity.longitude, -180, 180)) {
    add("Mi parcela · Identificación", "Ingresá latitud entre −90 y 90 y longitud entre −180 y 180.", "#parcela/identificacion");
  }
  const soilIssues = soilErrors(soil);
  for (const [key, label] of soilDefinitions) if (soilIssues[key]) add("Mi parcela · Caracterización del suelo", `${label} · ${soilIssues[key]}`, "#parcela/suelo");
  const windows = historicalWindows(historical);
  if (!windows.valid) add("Explorar estrategias · Clima histórico", Object.values(windows.errors)[0] || windows.rows.find(({ error }) => error)?.error || "Revisá los períodos históricos.", "#estrategias/clima");
  if (!strategies.length) add("Mesa comparativa", "Seleccioná al menos una estrategia.", "#estrategias/comparar");
  for (const strategy of strategies) {
    const href = strategy.isTemplate ? "#estrategias/biblioteca" : `#estrategias/editor/${strategy.id}`;
    const cropStages = strategy.stages.filter(isCropStage);
    if (!cropStages.length) add(strategy.name, "La estrategia no tiene cultivos.", href);
    for (const stage of cropStages) {
      const where = `${strategy.name} · ${stageName(stage)}`;
      const data = stage.agronomy ?? {};
      if (!CROP_MODEL_MAP[stage.cropId]) { add(where, "Sin modelo disponible para esta especie.", href); continue; }
      if (![1, 2].includes(integerValue(data.sowing?.window_year)) || !recurringDate(data.sowing?.day, data.sowing?.month)) add(where, "Completá campaña relativa, día y mes de siembra.", href);
      if (stage.kind === "commercial" && (numberValue(data.ym?.value) === null || data.ym.unit !== "t/ha")) add(where, "Indicá el rendimiento de referencia Ym en t/ha.", href);
      const lengths = DURATION_KEYS.map((key) => data.durations?.[key]);
      if (lengths.some(filled) && lengths.some((days) => integerValue(days) === null)) add(where, "Completá las cuatro duraciones con días enteros o dejalas vacías.", href);
      if (filled(data.residue?.value) && numberValue(data.residue.value) === null) add(where, "La cobertura de rastrojos debe ser numérica.", href);
      for (const key of [...ADVANCED_KEYS, ...ROOT_KEYS]) {
        if (filled(data.advanced?.[key]?.value) && numberValue(data.advanced[key].value) === null) add(where, `${key} · Ingresá un valor numérico o dejalo vacío.`, href);
      }
    }
  }
  return issues;
}

/**
 * Demonstration inputs: the documented example of the contract 1.0 (Villa Mercedes, San Luis).
 * They are declared as assumptions and never replace prices or costs already entered.
 */
export function demoPreparation(draft) {
  const soilRow = (value, unit) => ({ value, unit, source: DEMO_SOURCE, basis: "Supuesto" });
  const price = (crop, amount) => ({ id: `demo-price-${crop}`, crop, amount, currency: "USD", unit: "t", sourceType: "Otra fuente declarada", source: DEMO_SOURCE });
  const cost = (strategy, crop, amount) => ({ id: `demo-cost-${strategy}-${crop}`, strategy, crop, amount, currency: "USD", unit: "USD/ha",
    operation: "Costos directos del cultivo", category: "Otros costos directos", period: "Dos campañas", source: DEMO_SOURCE });
  return {
    identity: { ...draft.identity, latitude: "-33.68", longitude: "-65.47" },
    soil: { ...draft.soil, fieldCapacity: soilRow("0.28", "m³/m³"), wiltingPoint: soilRow("0.12", "m³/m³"), depth: soilRow("1.2", "m"), availableWater: soilRow("50", "%") },
    historical: { start_day: "1", start_month: "7", start_years: [2008, 2011, 2017] },
    prices: draft.prices.length ? draft.prices : [price("Maíz", "180"), price("Soja", "300"), price("Trigo", "200")],
    costs: draft.costs.length ? draft.costs : [cost("A", "Maíz", "620"), cost("A", "Soja", "380"), cost("B", "Maíz", "620"), cost("B", "Centeno", "95"),
      cost("B", "Soja", "380"), cost("C", "Maíz", "620"), cost("C", "Trigo", "420"), cost("C", "Soja", "300")],
  };
}
