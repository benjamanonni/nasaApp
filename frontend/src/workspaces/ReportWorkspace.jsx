import PreparationReview, { preparationRows } from "./PreparationReview.jsx";
import { soilErrors, historicalWindows } from "./preparation.js";
import { cropIssues, strategyIssues } from "./strategies/agronomy.js";
import { formatMoney, formatNumber } from "../data/presentation.js";
import { DataTable, Field, Panel, Status } from "./Controls.jsx";
import { comparisonRows, comparisonPeriod, selectedStrategies, yieldColumns, yieldValues } from "./comparison.js";
import { economicEntryIssue, economicResultNotice, hasEconomicEntries } from "./economics.js";
import { getWarnings } from "./InterpretationWorkspace.jsx";
import { exportDraft, validIdentity } from "./session.js";
import { validateStrategy, strategyHorizon, reviewLabel, stageName } from "./strategies/model.js";
import { DEMO_LABEL, STATUS_LABELS, simulationContext } from "./simulation.js";
import SimulationResults, { DemoNotice } from "./SimulationResults.jsx";
import { CONTRACT_VERSION } from "./preparation.js";

export function buildReportPayload({ parcel, referenceParcel, draft, strategies, comparisonIds, parcelRotations, selected, scenario }) {
  const declared = exportDraft(draft);
  const soilIssues = soilErrors(draft.soil);
  const windows = historicalWindows(draft.historical);
  const selectedItems = selectedStrategies(strategies, comparisonIds);
  const incompleteStrategies = declared.strategies.filter((strategy) => !validateStrategy(strategy).valid);
  const prices = declared.prices.filter((row) => !economicEntryIssue(row));
  const costs = declared.costs.filter((row) => !economicEntryIssue(row));
  const simulation = simulationContext({ parcel, draft, strategies, comparisonIds });
  return {
    contractVersion: CONTRACT_VERSION,
    contractRequest: simulation.request,
    contractStrategyMap: simulation.strategyMap,
    contractRequestIssues: simulation.issues,
    simulationStatus: STATUS_LABELS[simulation.status],
    simulationExecutedAt: simulation.run?.executedAt ?? null,
    simulationExecutedRequest: simulation.status === "stale" ? simulation.run.request : undefined,
    simulationResponse: simulation.response,
    simulationError: simulation.run?.error ?? null,
    context: { parcelId: parcel.id, strategyId: selected.id, comparisonIds: selectedItems.map(({ id }) => id), scenario, period: comparisonPeriod },
    preparation: preparationRows(draft, simulation.economy),
    costAssignment: { assigned: simulation.economy.assignedCosts, unassigned: simulation.economy.unassignedCosts },
    draftsForReview: { strategies: declared.strategies, soil: draft.soil, historical: draft.historical, status: "Declaraciones originales pendientes de revisión" },
    declared: { ...declared, soil: Object.fromEntries(Object.entries(declared.soil).filter(([key])=>!soilIssues[key])), historical: windows.valid ? draft.historical : undefined, prices, costs, strategies: declared.strategies.filter((strategy) => validateStrategy(strategy).valid && !strategyIssues(strategy).length) },
    comparedStrategies: selectedItems.map(({ id, name, sequence, isTemplate }) => ({ id, name, sequence, isTemplate })),
    demonstration: { label: DEMO_LABEL, parcel: { id: parcel.id, name: referenceParcel.name, area: referenceParcel.area, texture: referenceParcel.texture },
      unit: "ARS/ha", horizon: comparisonPeriod, comparisons: comparisonRows(selectedItems, parcelRotations)
        .flatMap(({ demonstration }) => demonstration ? [{
          id: demonstration.id, income: demonstration.income, cost: demonstration.cost, margin: demonstration.margin,
          deficitMm: demonstration.deficit, coverMonths: demonstration.cover, yieldsTonnesPerHectare: demonstration.yields,
        }] : []) },
    pending: { agronomicStrategyIds: draft.strategies.filter(s=>strategyIssues(s).length).map(s=>s.id), soilIssues, historicalIssues: windows, economicCalculation: hasEconomicEntries(draft), strategyIds: selectedItems.filter(({ isTemplate }) => !isTemplate).map(({ id }) => id),
      excludedPriceRows: draft.prices.length - prices.length, excludedCostRows: draft.costs.length - costs.length,
      incompleteStrategyIds: incompleteStrategies.map(({ id }) => id) },
    warnings: getWarnings(draft),
  };
}

export function ReportContent(props) {
  const { parcel, draft, parcelRotations, selected, scenario, strategies, comparisonIds } = props;
  const identity = validIdentity(draft.identity);
  const rows = comparisonRows(selectedStrategies(strategies, comparisonIds), parcelRotations);
  const economicNotice = economicResultNotice(draft);
  const simulation = simulationContext({ parcel, draft, strategies, comparisonIds });
  return <article className="report-content">
    <header><p className="eyebrow">AgroDSS · Informe de análisis</p><h2>{parcel.name} · {parcel.displayId}</h2>
      <p>Horizonte de dos campañas · {scenario}</p></header>
    {simulation.response ? <Status>{STATUS_LABELS[simulation.status]} · Las cifras provienen del motor de cálculo con datos de NASA POWER.</Status>
      : <DemoNotice>Las cifras disponibles son referencias ficticias de dos campañas independientes de las entradas declaradas.</DemoNotice>}
    {simulation.response ? null : economicNotice ? <Status tone="warning">{economicNotice}</Status> : <p className="work-note">Precios y costos declarados · Sin información.</p>}
    <dl className="work-readout">
      <div><dt>Localidad declarada</dt><dd>{[identity.locality, identity.province].filter(Boolean).join(" · ") || "Sin informar"}</dd></div>
      <div><dt>Superficie declarada</dt><dd>{identity.area ? `${identity.area} ha` : "Sin informar"}</dd></div>
      <div><dt>Sistema declarado</dt><dd>{identity.production || "Sin informar"}</dd></div>
      <div><dt>Años declarados</dt><dd>{identity.firstYear || "Inicio sin informar"} · {identity.lastYear || "Fin sin informar"}</dd></div>
      <div><dt>Estrategia inspeccionada</dt><dd>{selected.name}{!comparisonIds.includes(selected.id) && " · Fuera de la comparación"}</dd></div>
    </dl>
    <DataTable caption="Estrategias seleccionadas en la mesa" columns={["Estrategia", "Secuencia", "Horizonte", "Revisión", "Resultados"]}
      empty="No hay estrategias seleccionadas en la mesa." rows={rows.map(({ strategy, status }) => ({
        id: strategy.id, cells: [strategy.name, strategy.sequence, strategyHorizon(strategy), reviewLabel(strategy),
          !simulation.response ? status : Object.values(simulation.run.strategyMap).includes(strategy.id) ? "Calculado por el motor" : "Fuera de la última ejecución"],
      }))} />
    {simulation.response ? <SimulationResults run={simulation.run} status={simulation.status} strategies={strategies} /> : <>
    <DataTable caption="Indicadores disponibles · Referencia de ejemplo · Dos campañas" numericColumns={[2, 3, 4, 5, 6]}
      columns={["Estrategia", "Estado", "Ingresos (ARS/ha)", "Costos (ARS/ha)", "Margen (ARS/ha)", "Déficit (mm)", "Cultivo vivo (meses)"]}
      rows={rows.map(({ strategy, demonstration: demo, status }) => ({ id: strategy.id, cells: [strategy.name, status,
        demo ? formatMoney(demo.income) : "Pendiente", demo ? formatMoney(demo.cost) : "Pendiente",
        demo ? formatMoney(demo.margin) : "Pendiente", demo ? formatNumber(demo.deficit) : "Pendiente",
        demo ? formatNumber(demo.cover) : "Pendiente"] }))} />
    <DataTable caption="Rendimientos disponibles (t/ha) · Referencia de ejemplo · Dos campañas"
      numericColumns={yieldColumns.map((_, index) => index + 1)} columns={["Estrategia", ...yieldColumns.map(([, label]) => label)]}
      rows={rows.filter(({ demonstration }) => demonstration).map(({ strategy, demonstration }) => ({
        id: strategy.id,
        cells: [strategy.name, ...yieldValues(strategy, demonstration).map((value) => value === null ? "No aplicable" : formatNumber(value))],
      }))} empty="No hay rendimientos disponibles para la selección." />
    </>}
    <PreparationReview draft={draft} economy={simulation.economy} />
    <h3>Parámetros de las estrategias seleccionadas</h3>
    <DataTable caption="Entradas declaradas por cultivo" columns={["Estrategia","Etapa","Ym (t/ha)","Siembra relativa","Rastrojos (%)","Revisión"]}
      rows={rows.flatMap(({strategy})=>strategy.stages.map(stage=>{const issues=cropIssues(stage), data=stage.agronomy ?? {};return {id:strategy.id+"-"+stage.id,cells:[strategy.name,stageName(stage),issues.ym ? "Pendiente" : data.ym?.value,issues.sowing ? "Pendiente" : [data.sowing?.window_year,data.sowing?.day,data.sowing?.month].filter(Boolean).join(" / "),issues.residue ? "Pendiente" : data.residue?.value,Object.values(issues).join(" ") || "Pendiente de revisión técnica"]};}))}/>
    <h3>Períodos históricos preparados</h3>
    <ul>{historicalWindows(draft.historical).rows.map(row=><li key={row.year}>{row.error ? "Ventana pendiente de corrección" : row.start+" → "+row.end} · {simulation.response?.scenarios.some(({ start_year: year }) => year === Number(row.year)) ? "Consultado en NASA POWER" : "Clima sin consultar"}</li>)}</ul>
    <h3>Entradas hídricas declaradas</h3>
    <DataTable caption="Propiedades con unidad y fuente" columns={["Propiedad","Valor","Unidad","Fuente","Condición"]} rows={Object.entries(draft.soil).map(([key,row])=>({id:key,cells:[key,soilErrors(draft.soil)[key] ? "Entrada pendiente de corrección" : row.value,row.unit,row.source,row.basis]}))}/>
    <h3>Supuestos y advertencias</h3>
    <ul className="work-list">{getWarnings(draft).map(([type, message], index) => (
      <li key={index}><strong>{type}.</strong> {message}</li>
    ))}</ul>
    <h3>Observaciones profesionales</h3><p className="report-notes">{draft.notes || "Sin observaciones declaradas."}</p>
  </article>;
}

function downloadReport(report) {
  const payload = buildReportPayload(report);
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `agrodss-${report.parcel.id}-sesion.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportWorkspace({ section, patch, ...report }) {
  if (section === "gestion") return <Panel title="Gestión del análisis" description="Los datos se conservan en la sesión abierta. Exportá una copia antes de cerrar o recargar.">
    <Field label="Observaciones profesionales" multiline value={report.draft.notes} onChange={(notes) => patch({ notes })} />
    <p className="work-note">El JSON separa entradas válidas, referencias ficticias y estados pendientes, e incluye la solicitud exacta del contrato 1.0 (contractRequest) y la respuesta del motor (simulationResponse) cuando fue ejecutado. Los adjuntos se incluyen como metadatos.</p>
    <button type="button" className="work-button primary" onClick={() => downloadReport(report)}>Exportar datos de sesión (JSON)</button>
  </Panel>;
  return <>
    {section === "impresion" && <Panel title="Impresión" description="El navegador prepara el informe con sus unidades, supuestos y advertencias.">
      <button type="button" className="work-button primary" onClick={() => window.print()}>Imprimir informe</button>
    </Panel>}
    <Panel title={section === "impresion" ? "Vista previa" : "Vista general"}><ReportContent {...report} /></Panel>
  </>;
}

