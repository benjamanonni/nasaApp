import { ComparisonChart } from "../components/MetricsPanel.jsx";
import { formatMoney, metrics } from "../data/presentation.js";
import { DataTable, Field, Panel, Status } from "./Controls.jsx";
import { economicEntryErrors, economicResultNotice, priceSources } from "./economics.js";
import { updateRecord } from "./session.js";
import { CostAssignment, DemoNotice, EconomyResultTables, EngineGate } from "./SimulationResults.jsx";

const crops = ["Maíz", "Soja", "Soja de primera", "Soja de segunda", "Trigo"];
const priceFields = [
  ["crop", "Cultivo", { options: crops }], ["amount", "Precio", { inputMode: "decimal", autoComplete: "off" }],
  ["currency", "Moneda", { options: ["ARS", "USD"] }], ["unit", "Unidad comercial"], ["source", "Fuente del precio"],
  ["sourceType", "Procedencia", { options: priceSources }], ["date", "Fecha de referencia", { type: "date" }],
];
const categories = ["Implantación", "Semillas", "Insumos", "Fertilización declarada", "Manejo", "Terminación de cobertura", "Cosecha", "Otros costos directos"];
const costFields = [
  ["strategy", "Estrategia", { options: ["A", "B", "C"] }], ["operation", "Cultivo u operación"], ["category", "Tipo de actividad", { options: categories }],
  ["crop", "Cultivo"], ["description", "Descripción"], ["amount", "Costo", { inputMode: "decimal", autoComplete: "off" }],
  ["currency", "Moneda", { options: ["ARS", "USD"] }], ["unit", "Unidad"], ["period", "Fecha o campaña"], ["source", "Fuente o supuesto"],
];

function EditableEntries({ caption, fields, rows, onChange }) {
  return <>
    <DataTable caption={caption} columns={[...fields.map(([, label]) => label), "Acción"]}
      rows={rows.map((row, index) => ({ id: row.id, cells: [
        ...fields.map(([key, label, props]) => <Field label={`${label} · Fila ${index + 1}`} value={row[key]} {...props}
          error={Object.entries(row).some(([field, value]) => field !== "id" && value) ? economicEntryErrors(row)[key] : undefined}
          onChange={(value) => onChange(updateRecord(rows, row.id, key === "strategy" || key === "operation" ? { [key]: value, operationId: "" } : { [key]: value }))} />),
        <button type="button" className="work-button" aria-label={`Quitar fila ${index + 1}`}
          onClick={() => onChange(rows.filter(({ id }) => id !== row.id))}>Quitar</button>,
      ] }))} />
    <button type="button" className="work-button primary" onClick={() => onChange([...rows, { id: crypto.randomUUID() }])}>Agregar fila</button>
  </>;
}

export function EconomicComparison({ rotations, selectedId, onInspectResult }) {
  function value(id, indicatorId, label, amount) {
    const shown = formatMoney(amount);
    return onInspectResult ? <button type="button" className="work-button strategy-result" aria-label={label + " de " + id}
      onClick={() => onInspectResult(id, { result: { indicatorId, label, shown, unit: "ARS/ha" } })}>{shown}</button> : shown;
  }
  return (
    <DataTable caption="Referencia de ejemplo · ARS/ha · Dos campañas" numericColumns={[1, 2, 3]} columns={["Estrategia", "Ingresos", "Costos directos", "Margen bruto"]}
      rows={rotations.map(({ id, label, income, cost, margin }) => ({ id, selected: id === selectedId,
        cells: [`${id} · ${label}`, value(id, "income", "Ingresos", income), value(id, "cost", "Costos directos", cost), value(id, "margin", "Margen bruto", margin)] }))} />
  );
}

export default function EconomyWorkspace({ section, parcelRotations, selectedId, draft, patch, scenario, explorerOpen, onOpenExplorer, strategyBook, onInspectResult, engine }) {
  const simulation = engine?.simulation;
  const notice = simulation?.response ? "" : economicResultNotice(draft);
  const pending = notice && <Status tone="warning">{notice}</Status>;
  if (section === "avanzada") return <Panel title="Exploración económica avanzada" description="Análisis fuera del alcance de esta versión. La comparación económica usa los márgenes brutos que calcula el motor.">
    <ul className="work-list"><li>Comparación por hectárea y superficie total</li><li>Sensibilidad a precios y rendimientos</li><li>Punto de equilibrio</li><li>Flujo de caja</li></ul>
  </Panel>;
  if (section === "comparacion") return <>
        {pending}<Panel title="Comparación económica"
      description={simulation?.response ? "Ingresos, costos directos y margen bruto calculados por el motor · Dos campañas por escenario histórico" : `${scenario} · Dos campañas`}
      actions={<button id="economic-explorer-trigger" type="button" className="work-button primary"
        aria-expanded={explorerOpen} aria-controls={explorerOpen ? "economic-explorer" : undefined} onClick={onOpenExplorer}>
        Explorar precios y costos
      </button>}>
      <EngineGate engine={engine}>
        {simulation?.response && <EconomyResultTables run={simulation.run} strategies={strategyBook?.strategies} />}
      </EngineGate>
      {!simulation?.response && <>
        <DemoNotice>La tabla y el gráfico siguientes son la referencia precargada, independiente de los precios y costos declarados.</DemoNotice>
        <EconomicComparison rotations={parcelRotations} selectedId={selectedId} onInspectResult={onInspectResult} />
        <h3>Margen bruto de ejemplo</h3>
        <ComparisonChart metric={metrics[0]} rotations={parcelRotations} selectedId={selectedId} />
      </>}
    </Panel>
    <Panel title="Costos que entran al cálculo" description="El motor recibe un costo directo por hectárea para cada cultivo de las estrategias de la mesa comparativa.">
      <CostAssignment economy={simulation?.economy} />
    </Panel>
    <Panel title="Desglose de costos declarados" description="Detalle de las filas ingresadas. Se conservan las monedas y unidades originales.">
      <DataTable caption="Actividades declaradas" numericColumns={[3]} columns={["Estrategia", "Actividad", "Categoría", "Costo", "Moneda", "Unidad", "Fecha o campaña"]}
        rows={draft.costs.map(({ id, strategy, operation, category, amount, currency, unit, period }) => ({
          id, cells: [strategyBook?.strategies.find(({ id }) => id === strategy)?.name || strategy, operation, category, amount, currency, unit, period],
        }))} />
    </Panel>
  </>;
  const isPrice = section === "precios";
  const key = isPrice ? "prices" : "costs";
  const fields = (isPrice ? priceFields : costFields).map(([id, label, props]) => {
    if (id === "strategy" && strategyBook) return [id, label, { options: strategyBook.strategies.map((strategy) => [strategy.id, strategy.name]) }];
    if (id === "crop" && isPrice || id === "category") {
      const options = [...new Set([...props.options, ...draft[key].map((row) => row[id]).filter(Boolean)])];
      return [id, label, { options }];
    }
    return [id, label, props];
  });
  return <Panel title={isPrice ? "Precios declarados" : "Costos de actividades"} description="Edición disponible en esta sesión. Los cambios se conservan por parcela.">
    {pending}
    <EditableEntries caption={isPrice ? "Precios de cultivos" : "Presupuesto de actividades"} fields={fields}
      rows={draft[key]} onChange={(rows) => patch({ [key]: rows })} />
    {!isPrice && <><h3>Asignación de los costos a los cultivos</h3>
      <p className="work-note">Un costo entra al cálculo si pertenece a una estrategia de la mesa comparativa, está expresado por hectárea y su cultivo coincide con un cultivo de la estrategia (o está vinculado a una de sus operaciones).</p>
      <CostAssignment economy={simulation?.economy} /></>}
  </Panel>;
}

