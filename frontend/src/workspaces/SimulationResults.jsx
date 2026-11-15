import { DataTable, Panel, Status } from "./Controls.jsx";
import { DEMO_LABEL, STATUS_LABELS, cropName, formatValue, moneyUnit, rangeText, rotationLabel } from "./simulation.js";

const originLabels = { user: "Ingresado por el usuario", fao_reference: "Referencia FAO", team_default: "Decisión del equipo", system_default: "Definición del modelo" };
const scopeLabels = { request: "Solicitud", rotation: "Rotación", crop: "Cultivo", fallow: "Barbecho", scenario: "Escenario", date: "Fecha" };

function scopeText({ level, rotation_id: rotationId, position, after_position: afterPosition, parameter, start_year: startYear }) {
  return [scopeLabels[level] ?? level, rotationId, position && `cultivo ${position}`, afterPosition !== null && afterPosition !== undefined && `tras cultivo ${afterPosition}`,
    parameter, startYear].filter(Boolean).join(" · ");
}

/** Alert with the single error envelope of the backend: message, request id and field details. */
export function SimulationError({ error }) {
  if (!error) return null;
  return <div className="work-status warning simulation-error" role="alert">
    <strong>No se pudo completar la simulación{error.status ? ` (HTTP ${error.status})` : ""}.</strong>
    <p>{error.message}</p>
    {error.details?.length > 0 && <ul className="work-list">{error.details.map(({ field, message }, index) => (
      <li key={`${field}-${index}`}><code>{field}</code> · {message}</li>
    ))}</ul>}
    <p className="work-note">Identificador de la solicitud (request_id): {error.requestId || "sin identificador"}{error.retryable ? " · Podés reintentar." : ""}</p>
  </div>;
}

/** Button that runs the engine, with the state of the run and what is missing to run it. */
export function SimulationRunPanel({ simulation, onRun, onLoadDemo, onCheckService, service }) {
  const { status, issues, run, request } = simulation;
  const running = status === "running";
  const connecting = running && ["connecting", "waking"].includes(run?.phase);
  return <div className="simulation-run">
    <div className="strategy-actions">
      <button type="button" className="work-button primary" disabled={running || issues.length > 0 || !onRun} onClick={onRun}>
        {connecting ? "Conectando con el servicio de cálculo…" : running ? "Ejecutando simulación…" : "Ejecutar simulación (NASA POWER)"}</button>
      {onLoadDemo && <button type="button" className="work-button" disabled={running} onClick={onLoadDemo}>Cargar entradas de ejemplo</button>}
      {onCheckService && <button type="button" className="work-button" disabled={running} onClick={onCheckService}>
        {(service ? !service.startsWith("Servicio disponible") : status === "error") ? "Reintentar conexión" : "Comprobar servicio de cálculo"}</button>}
    </div>
    <Status tone={status === "stale" || status === "error" ? "warning" : "neutral"}>
      {connecting ? "Preparando la conexión" : STATUS_LABELS[status]}{run?.executedAt ? ` · Ejecutada el ${run.executedAt.slice(0, 16).replace("T", " ")} UTC` : ""}
      {status === "none" ? ` · ${request.rotations.length} estrategia(s) y ${request.window.start_years.length} escenario(s) histórico(s) preparados.` : ""}
    </Status>
    {connecting && <p className="work-note" role="status">{run.phase === "waking"
      ? "El servicio todavía no responde. Puede estar iniciándose. Reintentando conexión…"
      : "Conectando con el servicio de cálculo…"}</p>}
    {service && <p className="work-note" role="status">{service}</p>}
    {issues.length > 0 && <>
      <p className="work-note">Para ejecutar el motor falta completar:</p>
      <ul className="work-list">{issues.map(({ where, message }, index) => <li key={index}><strong>{where}.</strong> {message}</li>)}</ul>
    </>}
    {simulation.economy.unassignedCosts.length > 0 && <CostAssignment economy={simulation.economy} onlyExcluded />}
    {simulation.economy.incompatible && <Status tone="warning">Hay precios y costos en monedas distintas ({simulation.economy.currencies.join(", ")}). Se envían sin datos económicos y el motor informará el margen como no calculado.</Status>}
    {status !== "running" && <SimulationError error={run?.error} />}
  </div>;
}

export function RangeTables({ run, strategies }) {
  const { response } = run;
  const exposure = response.results[0]?.soil_exposure;
  const wind = exposure ? `${exposure.wind_variable} > ${formatValue(exposure.threshold_ms)} m/s` : "WS2M_MAX > 8 m/s";
  return <>
    <DataTable caption="Rangos descriptivos por rotación · mínimo · mediana · máximo" numericColumns={[1, 2, 3]}
      columns={["Rotación", "Escenarios incluidos", `Margen bruto (${moneyUnit(response)})`, `Días de viento fuerte sin cultivo vivo (${wind})`]}
      rows={response.ranges.map((range) => ({ id: range.rotation_id, cells: [rotationLabel(run, strategies, range.rotation_id),
        `${range.n_scenarios}${range.scenarios_excluded?.length ? ` · excluidos: ${range.scenarios_excluded.join(", ")}` : ""}`,
        range.gross_margin_per_ha ? rangeText(range.gross_margin_per_ha, 2)
          : `No calculado${range.margin_not_computed_years?.length ? ` (${range.margin_not_computed_years.join(", ")})` : ""}`,
        rangeText(range.strong_wind_days_without_live_crop, 0)] }))} />
    <DataTable caption="Rangos descriptivos por cultivo · mínimo · mediana · máximo" numericColumns={[2, 3]}
      columns={["Rotación", "Cultivo", "Rendimiento (t/ha)", "Cociente ETa/ETm"]}
      rows={response.ranges.flatMap((range) => range.crops.map((crop) => ({ id: `${range.rotation_id}-${crop.position}`, cells: [
        rotationLabel(run, strategies, range.rotation_id), cropName(response, range.rotation_id, crop.position),
        crop.yield_t_ha ? rangeText(crop.yield_t_ha, 2) : "No aplicable", rangeText(crop.eta_etm_ratio, 3)] })))} />
    {response.ranges[0]?.label && <p className="work-note">{response.ranges[0].label}</p>}
  </>;
}

export function ScenarioTable({ response }) {
  return <DataTable caption="Escenarios históricos" numericColumns={[3, 4]}
    columns={["Año de inicio", "Ventana", "Estado", "Precipitación (mm)", "ET₀ (mm)", "Datos sustituidos o motivo del bloqueo"]}
    rows={response.scenarios.map((scenario) => ({ id: scenario.start_year, cells: [scenario.start_year,
      `${scenario.window_start} → ${scenario.window_end} · ${scenario.days} días`, scenario.status === "computed" ? "Calculado" : "Bloqueado",
      formatValue(scenario.precipitation_total_mm), formatValue(scenario.et0_total_mm),
      scenario.status === "blocked" ? (scenario.blocked_reasons ?? []).map(({ message }) => message).join(" ")
        : (scenario.substituted_days ?? []).map(({ variable, method, count }) => `${variable}: ${count} día(s) · ${method}`).join(" · ") || "Sin sustituciones"] }))} />;
}

export function ResultTable({ run, strategies }) {
  const { response } = run;
  return <DataTable caption="Resultados por rotación y escenario histórico" numericColumns={[4, 5, 6]}
    columns={["Rotación", "Año de inicio", "Rendimiento (t/ha)", "ETa/ETm", `Margen bruto (${moneyUnit(response)})`, "Días de viento fuerte sin cultivo vivo", "Cierre de masa (mm)"]}
    empty="Ningún escenario pudo calcularse."
    rows={response.results.map((result) => {
      const economics = result.rotation_economics;
      const names = result.crops.map((crop) => [crop, cropName(response, result.rotation_id, crop.position)]);
      return { id: `${result.rotation_id}-${result.start_year}`, cells: [rotationLabel(run, strategies, result.rotation_id), result.start_year,
        names.map(([crop, name]) => `${name}: ${crop.yield_t_ha === null ? "no aplica" : formatValue(crop.yield_t_ha, 2)}`).join(" · "),
        names.map(([crop, name]) => `${name}: ${formatValue(crop.eta_etm_ratio, 3)}`).join(" · "),
        economics.status === "computed" ? formatValue(economics.gross_margin_per_ha, 2)
          : `No calculado · ${(economics.crops_missing_economics ?? []).map(({ reason }) => reason).join(" ") || "faltan datos económicos"}`,
        result.soil_exposure.strong_wind_days_without_live_crop, formatValue(result.water_balance.mass_balance_error_mm, 6)] };
    })} />;
}

export function ComparisonTable({ run, strategies }) {
  const { response } = run;
  if (!response.comparisons.length) return <p className="work-note">Sin diferencias de margen bruto entre rotaciones: se necesitan al menos dos rotaciones con margen calculado en el mismo escenario.</p>;
  return <>
    <DataTable caption={`Diferencias de margen bruto entre rotaciones (${moneyUnit(response)})`} numericColumns={[2]}
      columns={["Año de inicio", "Comparación", "Diferencia"]}
      rows={response.comparisons.map((comparison) => ({ id: `${comparison.start_year}-${comparison.minuend_rotation_id}-${comparison.subtrahend_rotation_id}`, cells: [
        comparison.start_year,
        `${rotationLabel(run, strategies, comparison.minuend_rotation_id)} − ${rotationLabel(run, strategies, comparison.subtrahend_rotation_id)}`,
        formatValue(comparison.gross_margin_difference_per_ha, 2)] }))} />
    <p className="work-note">{response.comparisons[0].label}</p>
  </>;
}

export function WarningList({ response }) {
  return <ul className="work-list">{response.warnings.map(({ code, message }) => <li key={code}><strong>{code}.</strong> {message}</li>)}</ul>;
}

export function AssumptionTable({ response }) {
  return <DataTable caption="Supuestos efectivos del cálculo" columns={["Código", "Alcance", "Descripción", "Valor", "Origen", "Veces"]}
    rows={response.assumptions.map((assumption, index) => ({ id: `${assumption.code}-${index}`, cells: [assumption.code, scopeText(assumption.scope),
      assumption.description, assumption.value === null || assumption.value === undefined ? "No aplica" : [assumption.value, assumption.unit].filter(Boolean).join(" "),
      [originLabels[assumption.origin] ?? assumption.origin, assumption.source].filter(Boolean).join(" · "), assumption.count ?? 1] }))} />;
}

export function ProvenanceBlock({ response }) {
  const provenance = response.provenance;
  if (!provenance) return <Status tone="warning">No se consultó NASA POWER: ningún escenario quedó dentro de la cobertura de la fuente.</Status>;
  const source = provenance.source_location;
  return <>
    <dl className="work-readout">
      <div><dt>Fuente</dt><dd>{provenance.source} · {provenance.service}{provenance.source_version ? ` · versión ${provenance.source_version}` : ""}</dd></div>
      <div><dt>Consulta</dt><dd>{provenance.retrieval} · {String(provenance.queried_at).slice(0, 19).replace("T", " ")} UTC</dd></div>
      <div><dt>Punto solicitado</dt><dd>{formatValue(provenance.requested_location.latitude_deg, 4)}° / {formatValue(provenance.requested_location.longitude_deg, 4)}°</dd></div>
      <div><dt>Celda de la fuente</dt><dd>{formatValue(source.latitude_deg, 4)}° / {formatValue(source.longitude_deg, 4)}° · {formatValue(source.elevation_m, 1)} m</dd></div>
      <div><dt>Fechas</dt><dd>{provenance.date_range.start} → {provenance.date_range.end}</dd></div>
      <div><dt>Escala</dt><dd>{provenance.label}</dd></div>
    </dl>
    <p className="work-note">{provenance.spatial_note}</p>
    <DataTable caption="Variables de NASA POWER" numericColumns={[4]} columns={["Variable", "Nombre", "Unidad", "Uso", "Días faltantes"]}
      rows={provenance.variables.map((variable) => ({ id: variable.code, cells: [variable.code, variable.name, variable.unit, variable.use, variable.missing_days] }))} />
  </>;
}

/** Real results of the engine for the compared strategies; `summary` keeps only ranges and warnings. */
export default function SimulationResults({ run, status, strategies, summary = false }) {
  const { response } = run;
  return <Panel title="Resultados del motor · FAO-56 y FAO-33 con NASA POWER"
    description={`Contrato ${response.contract_version} · modelo ${response.model_version} · solicitud ${response.request_id}`}>
    {status === "stale" && <Status tone="warning">{STATUS_LABELS.stale}. Las entradas cambiaron después de esta corrida: los resultados corresponden a las entradas anteriores.</Status>}
    <RangeTables run={run} strategies={strategies} />
    {!summary && <>
      <h3>Escenarios históricos</h3><ScenarioTable response={response} />
      <ResultTable run={run} strategies={strategies} />
      <h3>Comparaciones entre rotaciones</h3><ComparisonTable run={run} strategies={strategies} />
    </>}
    <h3>Advertencias</h3><WarningList response={response} />
    {!summary && <>
      <h3>Supuestos</h3><AssumptionTable response={response} />
      <h3>Procedencia de los datos climáticos</h3><ProvenanceBlock response={response} />
    </>}
  </Panel>;
}

/** Engine figures of one strategy for the contextual inspector. */
export function StrategyEngineSummary({ simulation, strategy }) {
  const { run, response, status } = simulation;
  if (!response) return <p className="work-note">{DEMO_LABEL}</p>;
  const rotationId = Object.entries(run.strategyMap).find(([, id]) => id === strategy.id)?.[0];
  const range = response.ranges.find((entry) => entry.rotation_id === rotationId);
  if (!range) return <p className="work-note">Esta estrategia no formó parte de la última ejecución del motor.</p>;
  const results = response.results.filter((result) => result.rotation_id === rotationId);
  return <>
    <h3>Resultados del motor · rotación {rotationId}</h3>
    {status === "stale" && <Status tone="warning">{STATUS_LABELS.stale}</Status>}
    <dl className="work-readout">
      <div><dt>Escenarios incluidos</dt><dd>{range.scenarios_included.join(", ") || "Ninguno"}</dd></div>
      <div><dt>Margen bruto ({moneyUnit(response)}) · mín · mediana · máx</dt><dd>{rangeText(range.gross_margin_per_ha, 2)}</dd></div>
      <div><dt>Días de viento fuerte sin cultivo vivo · mín · mediana · máx</dt><dd>{rangeText(range.strong_wind_days_without_live_crop, 0)}</dd></div>
      {range.crops.map((crop) => <div key={crop.position}><dt>{cropName(response, rotationId, crop.position)}</dt>
        <dd>{crop.yield_t_ha ? `${rangeText(crop.yield_t_ha, 2)} t/ha` : "Sin rendimiento de grano"} · ETa/ETm {rangeText(crop.eta_etm_ratio, 3)}</dd></div>)}
      <div><dt>Cierre de masa (mm)</dt><dd>{results.map((result) => `${result.start_year}: ${formatValue(result.water_balance.mass_balance_error_mm, 6)}`).join(" · ") || "Sin escenarios calculados"}</dd></div>
    </dl>
    <p className="work-note">{range.label}</p>
  </>;
}

export const RUN_PROMPT = "Ejecutá la simulación con NASA POWER para ver los resultados calculados.";

/**
 * Shows `children` only with a response of the engine. Without it, asks to run the simulation
 * and offers the quick access; with a stale run, warns and offers to recalculate.
 */
export function EngineGate({ engine, children }) {
  const simulation = engine?.simulation;
  const panel = simulation && <SimulationRunPanel simulation={simulation} service={engine.serviceNotice} onRun={engine.onRun}
    onLoadDemo={engine.onLoadDemo} onCheckService={engine.onCheckService} />;
  if (!simulation?.response) return <>
    <Status tone="warning">{RUN_PROMPT}</Status>
    {panel}
    {simulation && <a className="work-link" href="#estrategias/comparar">Ir a la mesa comparativa</a>}
  </>;
  return <>
    {simulation.status !== "current" && <>
      <Status tone="warning">{STATUS_LABELS.stale}. Los resultados corresponden a las entradas de la última ejecución.</Status>
      {panel}
    </>}
    {children}
  </>;
}

export function MarginRangeTable({ run, strategies }) {
  const { response } = run;
  return <>
    <DataTable caption={`Rango del margen bruto por rotación (${moneyUnit(response)}) · mínimo · mediana · máximo`} numericColumns={[2]}
      columns={["Rotación", "Escenarios incluidos", "Margen bruto", "Escenarios sin margen calculado"]}
      rows={response.ranges.map((range) => ({ id: range.rotation_id, cells: [rotationLabel(run, strategies, range.rotation_id),
        range.scenarios_included.join(", ") || "Ninguno", range.gross_margin_per_ha ? rangeText(range.gross_margin_per_ha, 2) : "No calculado",
        (range.margin_not_computed_years ?? []).join(", ") || "Ninguno"] }))} />
    {response.ranges[0]?.label && <p className="work-note">{response.ranges[0].label}</p>}
  </>;
}

const money = (value) => value === null || value === undefined ? "No calculado" : formatValue(value, 2);
const economicsNote = ({ status, note, reason, missing_fields: missing = [], gross_margin_label: label }) => status === "computed"
  ? [label, note].filter(Boolean).join(" · ") || "Calculado"
  : ["No calculado (not_computed)", reason, note, missing.length ? `Falta: ${missing.join(", ")}` : null].filter(Boolean).join(" · ");

/** Income, direct costs and gross margin of the response, by rotation and by crop. */
export function EconomyResultTables({ run, strategies }) {
  const { response } = run;
  const unit = moneyUnit(response);
  return <>
    <MarginRangeTable run={run} strategies={strategies} />
    <DataTable caption={`Economía por rotación y escenario histórico (${unit})`} numericColumns={[2, 3, 4]}
      columns={["Rotación", "Año de inicio", "Ingresos", "Costos directos", "Margen bruto", "Estado"]} empty="Ningún escenario pudo calcularse."
      rows={response.results.map((result) => {
        const economics = result.rotation_economics;
        const missing = (economics.crops_missing_economics ?? []).map(({ position, reason, missing_fields: fields = [] }) =>
          `${cropName(response, result.rotation_id, position)}: ${[reason, fields.length ? `falta ${fields.join(", ")}` : null].filter(Boolean).join(" · ")}`);
        return { id: `${result.rotation_id}-${result.start_year}`, cells: [rotationLabel(run, strategies, result.rotation_id), result.start_year,
          money(economics.income_per_ha), money(economics.direct_costs_per_ha), money(economics.gross_margin_per_ha),
          economics.status === "computed" ? economics.gross_margin_label || "Calculado" : ["No calculado (not_computed)", ...missing].join(" · ")] };
      })} />
    <DataTable caption={`Economía por cultivo y escenario histórico (${unit})`} numericColumns={[3, 4, 5, 6]}
      columns={["Rotación", "Año de inicio", "Cultivo", "Rendimiento (t/ha)", "Ingresos", "Costos directos", "Margen bruto", "Estado y nota"]}
      empty="Ningún escenario pudo calcularse."
      rows={response.results.flatMap((result) => result.crops.map((crop) => ({ id: `${result.rotation_id}-${result.start_year}-${crop.position}`, cells: [
        rotationLabel(run, strategies, result.rotation_id), result.start_year, cropName(response, result.rotation_id, crop.position),
        crop.yield_t_ha === null ? crop.yield_note || "No aplica" : formatValue(crop.yield_t_ha, 2),
        money(crop.economics.income_per_ha), money(crop.economics.direct_costs_per_ha), money(crop.economics.gross_margin_per_ha),
        economicsNote(crop.economics)] })))} />
    <h3>Diferencias entre rotaciones por escenario</h3>
    <ComparisonTable run={run} strategies={strategies} />
  </>;
}

/** Findings of the engine: water balance, water stress and soil exposure to wind. */
export function FindingsTables({ run, strategies }) {
  const { response } = run;
  const exposure = response.results[0]?.soil_exposure;
  return <>
    <DataTable caption="Balance hídrico del perfil por rotación y escenario (mm)" numericColumns={[2, 3, 4, 5, 6, 7, 8, 9]}
      columns={["Rotación", "Año de inicio", "Agua inicial", "Agua final", "Precipitación", "ET₀", "ETa de cultivos", "Evaporación en barbecho", "Excedente perdido", "Cierre de masa"]}
      empty="Ningún escenario pudo calcularse."
      rows={response.results.map(({ rotation_id: rotationId, start_year: year, water_balance: water }) => ({ id: `${rotationId}-${year}`, cells: [
        rotationLabel(run, strategies, rotationId), year, formatValue(water.initial_storage_mm), formatValue(water.final_storage_mm),
        formatValue(water.precipitation_mm), formatValue(water.et0_mm), formatValue(water.crop_eta_mm), formatValue(water.fallow_evaporation_mm),
        formatValue(water.excess_lost_mm), formatValue(water.mass_balance_error_mm, 6)] }))} />
    <DataTable caption="Agua y estrés hídrico por cultivo" numericColumns={[4, 5, 6, 7, 8]}
      columns={["Rotación", "Año de inicio", "Cultivo", "Siembra → fin de ciclo", "ETm (mm)", "ETa (mm)", "ETa/ETm", "Días con estrés", "Rendimiento relativo"]}
      empty="Ningún escenario pudo calcularse."
      rows={response.results.flatMap((result) => result.crops.map((crop) => ({ id: `${result.rotation_id}-${result.start_year}-${crop.position}`, cells: [
        rotationLabel(run, strategies, result.rotation_id), result.start_year, cropName(response, result.rotation_id, crop.position),
        `${crop.sowing_date} → ${crop.cycle_end_date}`, formatValue(crop.etm_mm), formatValue(crop.eta_mm), formatValue(crop.eta_etm_ratio, 3),
        crop.stress_days, crop.relative_yield === null ? crop.yield_note || "No aplica" : formatValue(crop.relative_yield, 3)] })))} />
    <DataTable caption="Exposición del suelo al viento por rotación y escenario (días)" numericColumns={[2, 3, 4, 5, 6]}
      columns={["Rotación", "Año de inicio", "Días de la ventana", "Con cultivo vivo", "Sin cultivo vivo", "Viento fuerte sin cultivo vivo", "Sin dato de viento sin cultivo vivo"]}
      empty="Ningún escenario pudo calcularse."
      rows={response.results.map(({ rotation_id: rotationId, start_year: year, soil_exposure: soil }) => ({ id: `${rotationId}-${year}`, cells: [
        rotationLabel(run, strategies, rotationId), year, soil.window_days, soil.live_crop_days, soil.no_live_crop_days,
        soil.strong_wind_days_without_live_crop, soil.no_wind_data_days_without_live_crop] }))} />
    {exposure && <p className="work-note">{exposure.rule} · Umbral {formatValue(exposure.threshold_ms)} m/s sobre {exposure.wind_variable} ({exposure.threshold_source}). {exposure.note}</p>}
  </>;
}

/** Which declared cost rows enter the request of the engine and which are left out, with the reason. */
export function CostAssignment({ economy, onlyExcluded = false }) {
  if (!economy) return null;
  const { assignedCosts, unassignedCosts, incompatible } = economy;
  if (!assignedCosts.length && !unassignedCosts.length) return <p className="work-note">Todavía no hay costos declarados para las estrategias de la mesa comparativa.</p>;
  return <div className="cost-assignment">
    {unassignedCosts.length > 0 && <>
      <Status tone="warning">{unassignedCosts.length} costo(s) declarado(s) no entran al cálculo. Vinculalos a un cultivo o convertí su unidad para incluirlos.</Status>
      <DataTable caption="Costos fuera del cálculo" columns={["Costo", "Estrategia", "Importe", "Motivo"]}
        rows={unassignedCosts.map(({ id, label, strategyName, amount, reason }) => ({ id, cells: [label, strategyName || "Sin estrategia", amount, reason] }))} />
    </>}
    {!onlyExcluded && incompatible && <Status tone="warning">Los precios y costos usan monedas distintas: ningún dato económico se envía al motor hasta unificarlas.</Status>}
    {!onlyExcluded && <DataTable caption={incompatible ? "Costos asignados a un cultivo (sin enviar por monedas distintas)" : "Costos que entran al cálculo"}
      columns={["Costo", "Estrategia", "Cultivo asignado", "Importe"]} empty="Ningún costo declarado entra al cálculo."
      rows={assignedCosts.map(({ id, label, strategyName, stageName, amount }) => ({ id, cells: [label, strategyName, stageName, amount] }))} />}
  </div>;
}

export function DemoNotice({ children }) {
  return <Status>{DEMO_LABEL}{children ? <> · {children}</> : null}</Status>;
}
