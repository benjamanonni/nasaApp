import { cropIssues, cropReference } from "./agronomy.js";
import { useState } from "react";
import { ComparisonChart } from "../../components/MetricsPanel.jsx";
import { formatMoney, formatNumber, metrics } from "../../data/presentation.js";
import { comparisonRows, selectedStrategies, yieldColumns, yieldValues } from "../comparison.js";
import { economicResultNotice } from "../economics.js";
import { DataTable, Panel, Status } from "../Controls.jsx";
import SimulationResults, { DemoNotice, SimulationRunPanel, StrategyEngineSummary } from "../SimulationResults.jsx";
import { calculationLabel, comparisonContext, dateTime, reviewLabel, sequenceText, stageName, strategyHorizon, validateStrategy } from "./model.js";

const indicatorViews = [["economy", "Economía"], ["water", "Agua"], ["soil", "Cobertura"], ["production", "Producción"]];
const day = 86_400_000;
const iso = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const dateLabel = (value) => value || "Sin fecha confirmada";

function OperationMarkers({ strategy, stage, start, range, inspection, inspect }) {
  const operationsByDate = new Map();
  for (const operation of stage.operations) {
    const entries = operationsByDate.get(operation.date) ?? [];
    operationsByDate.set(operation.date, [...entries, operation]);
  }
  return [...operationsByDate].map(([date, operations]) => {
    const label = `${operations.map(({ type }) => type).join(" / ")} · ${date}`;
    return <button key={date} type="button" className="strategy-operation-marker" title={label}
      aria-label={`${strategy.name} · ${label}`}
      aria-pressed={inspection.strategyId === strategy.id && inspection.operationDate === date && inspection.stageId === stage.id}
      style={{ left: `${(dateTime(date) - start) / range * 100}%` }}
      onClick={() => inspect(strategy.id, { stageId: stage.id, operationDate: date })} />;
  });
}

function StageButton({ strategy, stage, inspection, inspect, dated }) {
  const [left, width] = dated || [];
  return <button type="button" className="strategy-timeline-stage" data-kind={stage.kind}
    aria-pressed={inspection.strategyId === strategy.id && inspection.stageId === stage.id}
    aria-label={`${strategy.name} · ${stageName(stage)} · ${dateLabel(stage.startDate)}`}
    style={dated ? { marginLeft: `${left}%`, width: `${width}%` } : undefined}
    onClick={() => inspect(strategy.id, { stageId: stage.id })}>
    {stageName(stage)}{stage.operations.length ? ` · ${stage.operations.length} op.` : ""}
  </button>;
}

export function Timeline({ strategies, inspection, inspect, context }) {
  const { reference, incompatible, undated } = context;
  const excluded = new Set([...incompatible, ...undated].map(({ id }) => id));
  const dated = reference ? strategies.filter(({ id }) => !excluded.has(id)) : [];
  const schematic = reference ? undated : strategies;
  const start = reference ? dateTime(reference.startDate) : 0;
  const end = reference ? dateTime(reference.endDate) : 1;
  const dayRange = Math.max(day, end - start);
  const referenceDates = reference ? [...new Set([iso(start), iso(start + dayRange / 2), iso(end)])] : [];
  const overlaps = dated.filter((strategy) => validateStrategy(strategy).overlaps.length);
  return <Panel title="Cronología de comparación" description="Elegí una etapa para consultar sus fechas, operaciones y observaciones.">
    {dated.length > 0 && <div className="work-table-scroll strategy-timeline-scroll" tabIndex={0} role="region" aria-label="Cronología con escala de fechas">
      <div className="strategy-timeline">
        <div className="strategy-timeline-row"><strong>Horizonte común</strong><div className="strategy-axis" role="group" aria-label="Fechas de referencia">
          {referenceDates.map((date) => <button type="button" className="work-button strategy-reference-date" key={date} aria-pressed={inspection.referenceDate === date} onClick={() => inspect(dated.find(({ id }) => id === inspection.strategyId)?.id ?? reference.id, { referenceDate: date })}>{date}</button>)}
        </div></div>
        {dated.map((strategy) => <div className="strategy-timeline-row" key={strategy.id}>
          <strong>{strategy.name}</strong>
          <div>{strategy.stages.map((stage) => <div className="strategy-track" key={stage.id}>
            <StageButton strategy={strategy} stage={stage} inspect={inspect} inspection={inspection}
              dated={[(dateTime(stage.startDate) - start) / dayRange * 100, (dateTime(stage.endDate) - dateTime(stage.startDate)) / dayRange * 100]} />
            <OperationMarkers strategy={strategy} stage={stage} start={start} range={dayRange} inspection={inspection} inspect={inspect} />
          </div>)}</div>
        </div>)}
      </div>
    </div>}
    {dated.some((strategy) => strategy.stages.some(({ operations }) => operations.length)) && <p className="work-note">Los marcadores señalan operaciones fechadas. Seleccionalos para consultar el detalle.</p>}
    {schematic.length > 0 && <>
      <p className="work-note">Secuencias sin fechas confirmadas. Las posiciones de este esquema son ilustrativas.</p>
      <div className="work-table-scroll strategy-timeline-scroll" tabIndex={0} role="region" aria-label="Secuencias sin escala temporal">
        <div className="strategy-timeline">{schematic.map((strategy) => <div className="strategy-timeline-row" key={strategy.id}>
          <strong>{strategy.name}</strong><div className="strategy-actions">
            {strategy.stages.map((stage) => <StageButton key={stage.id} strategy={strategy} stage={stage} inspection={inspection} inspect={inspect} />)}
          </div>
        </div>)}</div>
      </div>
    </>}
    {overlaps.length > 0 && <Status tone="warning">Solapamientos de etapas en {overlaps.map(({ name }) => name).join(", ")}. Revisá el calendario agronómico.</Status>}
    {incompatible.length > 0 && <Status tone="warning">Horizonte distinto del período de referencia: {incompatible.map(({ name }) => name).join(", ")}. Quedan fuera de la escala común y de la comparación científica.</Status>}
  </Panel>;
}

const resultColumns = {
  economy: [["income", "Ingresos", "ARS/ha"], ["cost", "Costos directos", "ARS/ha"], ["margin", "Margen bruto", "ARS/ha"]],
  water: [["deficit", "Déficit hídrico", "mm"]],
  soil: [["cover", "Cultivo vivo", "meses"]],
  production: yieldColumns.map(([id, label]) => [id, label, "t/ha"]),
};
const missing = {
  economy: "Resultados económicos pendientes de cálculo",
  water: "Balance hídrico no disponible para esta estrategia",
  soil: "Cobertura no calculada para esta estrategia",
  production: "Rendimientos no disponibles para esta estrategia",
};

export function Results({ strategies, demoResults, metric, setMetric, inspect, selectedId, scenario, context, draft, visibleMetrics = indicatorViews }) {
  const columns = resultColumns[metric];
  const economyNotice = metric === "economy" && draft && economicResultNotice(draft);
  const compatible = strategies.filter((strategy) => !context.incompatible.includes(strategy));
  const available = comparisonRows(compatible, demoResults).flatMap(({ strategy, demonstration }) =>
    demonstration ? [{ ...demonstration, label: strategy.name }] : []);
  const chartMetric = metrics.find(({ id }) => id === metric);
  return <Panel title="Indicadores comparados" description={`${scenario} · Dos campañas. Las cifras de las plantillas son ficticias.`}>
    {visibleMetrics.length > 0 && <div className="strategy-actions" role="group" aria-label="Indicador comparado">
      {visibleMetrics.map(([id, label]) => <button type="button" className="work-button" aria-pressed={metric === id}
        key={id} onClick={() => setMetric(id)}>{label}</button>)}
    </div>}
    {economyNotice && <Status tone="warning">{economyNotice}</Status>}
    <DataTable caption="Disponibilidad por estrategia" numericColumns={columns.map((_, index) => index + 1)} columns={["Estrategia", ...columns.map(([, label, unit]) => `${label} (${unit})`)]}
      rows={strategies.map((strategy) => {
        const demo = available.find(({ id }) => id === strategy.id);
        const yields = metric === "production" ? yieldValues(strategy, demo) : [];
        return { id: strategy.id, selected: selectedId === strategy.id, cells: [
          strategy.name,
          ...columns.map(([key, label, unit], index) => {
            const value = metric === "production" ? yields[index] : demo?.[key];
            if (value === null) return "No aplicable";
            if (value === undefined) return index === 0 ? context.incompatible.includes(strategy) ? "Horizonte incompatible" : missing[metric] : "Sin resultado";
            const shown = metric === "economy" ? formatMoney(value) : formatNumber(value);
            return <button type="button" className="work-button strategy-result"
              aria-label={`${strategy.name} · ${label}: ${shown} ${unit}`}
              onClick={() => inspect(strategy.id, { result: { indicatorId: metric === "production" ? "yield" : key, label, shown, unit } })}>{shown}</button>;
          }),
        ] };
      })} />
    {available.length > 0 && metric !== "production" && <>
      <h3>{chartMetric.title}</h3>
      <ComparisonChart metric={chartMetric} rotations={available} selectedId={selectedId} />
      <p className="work-note">Fuente: valores ficticios precargados. El gráfico incluye las estrategias con cifras disponibles.</p>
    </>}
    {metric === "soil" && <p className="work-note">El barbecho es una etapa de manejo y puede conservar rastrojos. La exposición al viento se calcula al ejecutar la simulación.</p>}
    {metric === "water" && <p className="work-note">El déficit de ejemplo es un valor agregado. El balance hídrico real se calcula al ejecutar la simulación.</p>}
    {metric === "production" && <p className="work-note">Las cifras de soja corresponden a primera en Barbecho y a segunda en Doble cultivo. En Cobertura la soja también es de primera.</p>}
  </Panel>;
}

export default function StrategyComparison({ strategies, comparisonIds, onToggle, inspection, inspect, demoResults, scenario, parcelName, draft, onOpenExplorer, explorerOpen,
  simulation, serviceNotice, onRunSimulation, onCheckService, onRunExample }) {
  const [metric, setMetric] = useState("economy");
  const selected = selectedStrategies(strategies, comparisonIds);
  const context = comparisonContext(selected);
  return <>
    <Panel title="Mesa comparativa" description={[parcelName, "Dos campañas", scenario].filter(Boolean).join(" · ")}
      actions={<button id="economic-explorer-trigger" type="button" className="work-button"
        aria-expanded={explorerOpen} aria-controls={explorerOpen ? "economic-explorer" : undefined} onClick={onOpenExplorer}>Explorar precios y costos</button>}>
      {simulation && <SimulationRunPanel simulation={simulation} service={serviceNotice} onRun={onRunSimulation}
        onCheckService={onCheckService} onRunExample={onRunExample} />}
      <div className="strategy-actions">
        {strategies.map(({ id, name }) => {
          const included = comparisonIds.includes(id);
          return <button type="button" key={id} className="work-button" aria-pressed={included}
            disabled={!included && comparisonIds.length >= 3} aria-label={`${included ? "Retirar" : "Comparar"} ${name}`}
            onClick={() => onToggle(id)}>{name}</button>;
        })}
      </div>
      <p className="work-note" role="status">{selected.length} de 3 seleccionadas{selected.length === 3 ? " · Retirá una para agregar otra." : "."}</p>
      {selected.length < 2 && <Status tone="warning">Seleccioná al menos dos estrategias para compararlas.</Status>}
      <DataTable caption="Alternativas seleccionadas" columns={["Estrategia", "Secuencia", "Horizonte", "Revisión y resultados"]}
        rows={selected.map((strategy) => ({ id: strategy.id, selected: inspection.strategyId === strategy.id, cells: [
          <button type="button" className="work-button" aria-pressed={inspection.strategyId === strategy.id}
            onClick={() => inspect(strategy.id)}>{strategy.name}</button>,
          sequenceText(strategy), strategyHorizon(strategy), <>{reviewLabel(strategy)}<small className="strategy-id">{calculationLabel(strategy)}</small></>,
        ] }))} />
    </Panel>
    {selected.length > 0 && <>
      <Timeline strategies={selected} inspection={inspection} inspect={inspect} context={context} />
      {simulation?.response ? <SimulationResults run={simulation.run} status={simulation.status} strategies={strategies} /> : <>
        <DemoNotice>Las cifras siguientes son referencias precargadas, independientes de las entradas declaradas.</DemoNotice>
        <Results strategies={selected} demoResults={demoResults} metric={metric} setMetric={setMetric} inspect={inspect}
          selectedId={inspection.strategyId} scenario={scenario} context={context} draft={draft} />
      </>}
    </>}
  </>;
}

export function ContextualInspector({ strategy, inspection, simulation, onStage, outsideComparison, onClose }) {
  const stage = strategy?.stages.find(({ id }) => id === inspection.stageId);
  const result = inspection.result;
  const duration = stage && stage.startDate && stage.endDate ? Math.round((dateTime(stage.endDate) - dateTime(stage.startDate)) / day) : null;
  return <aside className="inspector strategy-inspector" id="parcel-inspector" tabIndex={-1} aria-label="Inspector contextual">
    <div className="sticky">
      <div className="inspector-top"><span className="eyebrow">Inspector contextual</span><button type="button" className="work-button" onClick={onClose}>Cerrar</button></div>
      {!strategy ? <p className="work-note">Seleccioná una estrategia o etapa para inspeccionarla.</p> : <>
        <h2>{strategy.name}</h2>
        <p>{sequenceText(strategy)}</p>
        {outsideComparison && <p className="work-note">Activa fuera de la mesa comparativa.</p>}
        <dl className="work-readout">
          <div><dt>Horizonte</dt><dd>{strategyHorizon(strategy)}</dd></div>
          <div><dt>Fechas</dt><dd>{dateLabel(strategy.startDate)} → {dateLabel(strategy.endDate)}</dd></div>
          <div><dt>Revisión</dt><dd>{reviewLabel(strategy)}</dd></div>
          <div><dt>Resultados</dt><dd>{calculationLabel(strategy)}</dd></div>
        </dl>
        {simulation && <StrategyEngineSummary simulation={simulation} strategy={strategy} />}
        {inspection.referenceDate ? <>
          <h3>Fecha de referencia</h3><p>{inspection.referenceDate} · Escala del calendario.</p>
          <p className="work-note">{strategy.stages.filter(({ startDate, endDate }) => startDate && endDate && startDate <= inspection.referenceDate && endDate >= inspection.referenceDate).map(stageName).join(" · ") || "Sin etapas registradas para esta fecha."}</p>
        </> : stage ? <>
          <h3>{stageName(stage)}</h3>
          <p className="work-note">{cropReference(stage)?.name || "Sin referencia de catálogo"} · {Object.values(cropIssues(stage)).join(" ") || "Entradas completas según el formulario"}</p>
          {stage.agronomy && <details className="work-details"><summary>Parámetros declarados</summary><dl className="work-readout">{[["Ym",stage.agronomy.ym],["Rastrojos",stage.agronomy.residue],...Object.entries(stage.agronomy.advanced ?? {})].map(([label,row])=><div key={label}><dt>{label}</dt><dd>{row?.value || "Sin informar"} {row?.unit} · {row?.source || "Fuente sin informar"}</dd></div>)}</dl></details>}
          <dl className="work-readout">
            <div><dt>Fechas previstas</dt><dd>{dateLabel(stage.startDate)} → {dateLabel(stage.endDate)}</dd></div>
            <div><dt>Duración</dt><dd>{duration === null ? "Sin dato" : `${duration} días entre fechas`}</dd></div>
            <div><dt>Parámetros del cultivo</dt><dd>{stage.cropId === "custom" ? "Sin modelo disponible para esta especie" : "Los parámetros vacíos toman la referencia del catálogo al ejecutar"}</dd></div>
            <div><dt>Validación</dt><dd>{strategy.isTemplate ? "Plantilla de ejemplo · Sin calendario confirmado"
              : Object.keys(validateStrategy(strategy).stageErrors[stage.id] ?? {}).length ? "Fechas o datos por completar" : "Datos registrados · Pendiente de revisión agronómica"}</dd></div>
            <div><dt>Observaciones</dt><dd>{stage.notes || "Sin observaciones"}</dd></div>
          </dl>
          <h3>{inspection.operationDate ? "Operación seleccionada" : "Operaciones registradas"}</h3>
          {stage.operations.length ? <ul className="work-list">{stage.operations.filter(({ date }) => !inspection.operationDate || date === inspection.operationDate).map((operation) => (
            <li key={operation.id} className={operation.date === inspection.operationDate ? "strategy-operation-active" : undefined}><strong>{operation.type}</strong> · {operation.date} {operation.description} {operation.notes}</li>
          ))}</ul> : <p className="work-note">Sin operaciones registradas.</p>}
        </> : result ? <>
          <h3>{result.label}</h3>
          <dl className="work-readout">
            <div><dt>Valor</dt><dd>{result.shown} · {result.unit}</dd></div>
            <div><dt>Fuente</dt><dd>Valores ficticios precargados</dd></div>
            <div><dt>Período</dt><dd>Dos campañas · Sin fecha puntual</dd></div>
            <div><dt>Estado</dt><dd>Referencia de ejemplo. Ejecutá la simulación para ver el valor calculado.</dd></div>
            <div><dt>Entradas</dt><dd>{result.indicatorId === "deficit" ? "Sin series de suelo, clima ni demanda vinculadas a este valor." : "Datos de la plantilla, independientes de las entradas de la sesión."}</dd></div>
            {result.indicatorId === "deficit" && <div><dt>Alcance</dt><dd>Escenario ficticio de secano. Solo se dispone del agregado, sin desglose por día o etapa.</dd></div>}
          </dl>
          {result.indicatorId && <a className="work-button" href={"#interpretacion/resultados/" + result.indicatorId}>Ver explicación del indicador</a>}
        </> : <>
          <h3>Etapas de la secuencia</h3>
          <ol className="work-list">{strategy.stages.map((item) => (
            <li key={item.id}>{onStage ? <button className="work-button" type="button" onClick={() => onStage(item.id)}>{stageName(item)}</button> : stageName(item)} · {dateLabel(item.startDate)} → {dateLabel(item.endDate)}</li>
          ))}</ol>
        </>}
      </>}
    </div>
  </aside>;
}

