import { useState } from "react";
import ContextNotes from "../components/ContextNotes.jsx";
import { DataTable, Field, Panel, Status } from "./Controls.jsx";
import { amountError, economicEntryErrors } from "./economics.js";
import { StudyResults } from "./LabStudies.jsx";
import { studyReviewLabel, validateIdentity } from "./session.js";
import { AssumptionTable, EngineGate, FindingsTables, ProvenanceBlock, RangeTables, WarningList } from "./SimulationResults.jsx";
import { STATUS_LABELS, moneyUnit } from "./simulation.js";

// What each indicator of the engine represents. `null` in the unit means «declared currency per hectare».
const indicators = [
  ["income", "Ingresos", "Rendimiento estimado de cada cultivo de grano por su precio declarado, en las dos campañas de un escenario histórico.", null,
    "Rendimiento calculado por el motor y precio por tonelada declarado.", "Ingreso = rendimiento (t/ha) × precio declarado"],
  ["cost", "Costos directos", "Suma de los costos directos por hectárea declarados para los cultivos de la rotación.", null,
    "Costos por hectárea declarados y asignados a cada cultivo.", "Suma de las entradas declaradas; no se estiman costos"],
  ["margin", "Margen bruto", "Ingresos menos costos directos de la rotación en las dos campañas. Un margen bruto negativo no es una pérdida neta.", null,
    "Ingresos y costos directos de cada cultivo.", "Margen bruto = ingreso − costos directos"],
  ["deficit", "Agua y estrés hídrico", "Evapotranspiración real frente a la máxima (ETa/ETm) y días con estrés hídrico de cada cultivo.", "mm · cociente · días",
    "Clima diario de NASA POWER, suelo declarado y parámetros del cultivo.", "Balance hídrico diario de FAO-56 con ET₀ de Penman–Monteith"],
  ["cover", "Exposición del suelo", "Días sin cultivo vivo y, entre ellos, días con viento fuerte. Es un indicador de exposición, no una estimación de erosión.", "días",
    "Calendario de cultivos y viento máximo diario de NASA POWER.", "Conteo de días según el umbral de viento documentado"],
  ["yield", "Rendimiento", "Rendimiento de cada cultivo de grano según el déficit hídrico del escenario histórico.", "t/ha",
    "Rendimiento de referencia Ym declarado, Ky y cociente ETa/ETm.", "Respuesta del rendimiento al agua de FAO-33"],
];

export function getWarnings(draft) {
  const soil = Object.values(draft.soil);
  const labResults = draft.studies.flatMap((study) => study.samples.flatMap(({ results }) => results));
  const executed = Boolean(draft.simulationRun?.response);
  return [
    ["Dato faltante", draft.identity.area ? "Revisar el expediente para ver campos sin dato." : "Superficie declarada sin dato."],
    ["Unidad por revisar", [...soil, ...draft.prices, ...draft.costs, ...labResults].some(({ value, amount, unit }) => (value || amount) && !unit)
      ? "Hay entradas con valor y sin unidad. Completá la unidad antes de ejecutar la simulación." : "Sin entradas con valor y sin unidad."],
    ...Object.entries(validateIdentity(draft.identity)).map(([field, message]) => [`Fecha o formato · ${field === "lastYear" || field === "firstYear" ? "Horizonte" : field === "area" ? "Superficie" : "Coordenadas"}`, message]),
    ...draft.studies.filter(({ sampleDate, analysisDate }) => sampleDate && analysisDate && analysisDate < sampleDate)
      .map(() => ["Fecha inválida", "Un estudio tiene fecha de análisis anterior al muestreo."]),
    ...([...draft.prices, ...draft.costs].some(({ amount }) => amountError(amount))
      ? [["Importe inválido", "Hay precios o costos declarados con un importe inválido."]] : []),
    ...[...draft.prices, ...draft.costs].filter(({ amount }) => amount).flatMap((row) => {
      const { currency, unit, date } = economicEntryErrors(row);
      return [currency, unit, date].filter(Boolean).map((message) => ["Entrada económica por revisar", message]);
    }),
    ["Calendario", "Las fechas de siembra y las duraciones de ciclo son declaraciones del usuario o referencias del catálogo."],
    ["Estado del cálculo", executed ? "Simulación ejecutada. Las advertencias y los supuestos del motor se informan junto a los resultados."
      : "Simulación sin ejecutar. Ejecutala con NASA POWER para obtener resultados, advertencias y supuestos del motor."],
    ["Parámetro supuesto", soil.some(({ basis }) => basis === "Supuesto") ? "Hay valores de suelo identificados como supuestos." : "Ningún valor de suelo está identificado como supuesto."],
    ["Revisión profesional", draft.studies.some((study) => studyReviewLabel(study) !== "Revisado manualmente")
      ? "Hay estudios pendientes de transcripción o revisión." : "Los resultados requieren revisión agronómica antes del uso técnico."],
    ...(draft.identity.production === "Con riego" ? [["Fuera del alcance actual", "El MVP representa secano."]] : []),
  ];
}

export default function InterpretationWorkspace({ section, draft, requestedIndicator, interpretationEvidence, engine, strategies }) {
  const [selection, setSelection] = useState(null);
  const simulation = engine?.simulation;
  const response = simulation?.response;
  const fallback = indicators.some(([id]) => id === requestedIndicator) ? requestedIndicator : "margin";
  const indicatorId = selection?.route === requestedIndicator ? selection?.id ?? fallback : fallback;
  const [, title, description, unit, inputs, method] = indicators.find(([id]) => id === indicatorId);
  const evidence = interpretationEvidence?.indicatorId === indicatorId ? interpretationEvidence : undefined;
  if (section === "nutricion") return <Panel title="Estudios y nutrición">
    <Status>Los indicadores de nutrientes se presentan como información de laboratorio. No forman parte de los cálculos agronómicos del MVP actual.</Status>
    <StudyResults studies={draft.studies} />
  </Panel>;
  if (section === "advertencias") return <>
    <Panel title="Advertencias y supuestos del motor" description="Lo que el motor informa junto a cada resultado.">
      <EngineGate engine={engine}>
        {response && <><WarningList response={response} /><AssumptionTable response={response} /></>}
      </EngineGate>
    </Panel>
    <Panel title="Consistencia de las entradas" description="Comprobaciones de formato del formulario. La validación agronómica la realiza el motor al ejecutar.">
      <DataTable caption="Controles del análisis" columns={["Tipo", "Situación"]}
        rows={getWarnings(draft).map(([type, message], index) => ({ id: index, cells: [type, message] }))} />
    </Panel>
  </>;
  if (section === "procedencia") return <>
    <Panel title="Procedencia de los datos climáticos" description="NASA POWER es un dato de modelo y reanálisis a escala de celda, no una medición del lote.">
      <EngineGate engine={engine}>{response && <ProvenanceBlock response={response} />}</EngineGate>
    </Panel>
    <Panel title="Inventario de fuentes"><DataTable caption="Inventario de fuentes" columns={["Fuente", "Disponibilidad", "Procedencia"]}
      rows={[
        ["NASA POWER", response?.provenance ? `Consultado el ${String(response.provenance.queried_at).slice(0, 10)}` : "Se consulta al ejecutar la simulación", "Series climáticas diarias de la celda"],
        ["Datos declarados", Object.values(draft.identity).some(Boolean) || Object.keys(draft.soil).length ? "Disponibles en sesión" : "Sin dato", "Edición manual por parcela"],
        ["Estudios de laboratorio", `${draft.studies.length} en sesión`, "Informe y transcripción manual"],
        ["Rendimientos observados", draft.history.some(({ yield: observed }) => observed) ? "Disponibles en sesión" : "Sin dato", "Antecedentes declarados"],
        ["Bibliografía y parámetros", response ? `Modelo ${response.model_version} · contrato ${response.contract_version}` : "Catálogo de referencia 1.0", "FAO-56 (balance hídrico) y FAO-33 (rendimiento); valores tabulados, no calibrados para el lote"],
        ["Supuestos", response ? `${response.assumptions.length} supuestos informados por el motor` : "Se informan al ejecutar la simulación", "Registro de supuestos de cada ejecución"],
      ].map(([source, status, basis]) => ({ id: source, cells: [source, status, basis] }))} /></Panel><ContextNotes />
  </>;
  return <>
    <Panel title="Hallazgos del motor" description="Balance hídrico, estrés hídrico y exposición del suelo de cada rotación en cada escenario histórico.">
      <EngineGate engine={engine}>
        {response && <>
          <Status>{STATUS_LABELS[simulation.status]} · Escenarios históricos descriptivos: no son probabilidades ni pronósticos.</Status>
          <RangeTables run={simulation.run} strategies={strategies} />
          <FindingsTables run={simulation.run} strategies={strategies} />
          <h3>Advertencias</h3><WarningList response={response} />
          <p className="work-note"><a className="work-link" href="#interpretacion/advertencias">Ver supuestos del motor</a> · <a className="work-link" href="#interpretacion/procedencia">Ver procedencia de NASA POWER</a></p>
        </>}
      </EngineGate>
    </Panel>
    <Panel title="Explicación de resultados" description="Qué representa cada indicador, su unidad y el procedimiento con que se calcula.">
      <Field label="Indicador" options={indicators.map(([id, label]) => [id, label])} value={indicatorId}
        onChange={(id) => setSelection({ route: requestedIndicator, id: id || "margin" })} />
      <h3>{title}</h3>
      {evidence && <p className="work-note">{evidence.strategyName} · {evidence.label} · {evidence.shown} {evidence.unit} · Dos campañas · Referencia de ejemplo</p>}
      <dl className="work-readout">{[["Qué representa", description], ["Unidad", unit ?? (response ? moneyUnit(response) : "moneda declarada/ha")], ["Entradas", inputs],
        ["Procedencia", response ? `Respuesta del motor · solicitud ${response.request_id}` : "Se calcula al ejecutar la simulación"], ["Modelo o procedimiento", method],
        ["Supuestos", "Secano, horizonte de dos campañas y parámetros de referencia no calibrados para el lote"],
        ["Limitaciones", "Escenarios históricos descriptivos. No incluye nitrógeno, malezas, enfermedades, erosión ni carbono, y requiere revisión profesional."]]
        .map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    </Panel>
  </>;
}
