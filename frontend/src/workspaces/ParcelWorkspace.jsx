import PreparationReview from "./PreparationReview.jsx";
import SoilInputs from "./SoilInputs.jsx";
import ParcelMap from "../components/ParcelMap.jsx";
import { DataTable, FieldGrid, Panel, Status } from "./Controls.jsx";
import LabStudies from "./LabStudies.jsx";
import LocalFiles from "./LocalFiles.jsx";
import { economicEntryIssue } from "./economics.js";
import { studyReviewLabel, updateRecord, validIdentity, validateIdentity } from "./session.js";

const identityFields = [
  ["name", "Nombre declarado"], ["identifier", "Identificador declarado"], ["province", "Provincia"], ["locality", "Localidad o referencia"],
  ["latitude", "Latitud (°; opcional)", { type: "number", step: "any" }], ["longitude", "Longitud (°; opcional)", { type: "number", step: "any" }],
  ["area", "Superficie (ha)", { type: "number", step: "any" }], ["production", "Tipo de producción", { options: ["Secano", "Con riego"] }],
  ["firstYear", "Año inicial", { inputMode: "numeric", maxLength: 4 }], ["lastYear", "Año final", { inputMode: "numeric", maxLength: 4 }],
  ["notes", "Observaciones generales (opcional)", { multiline: true }],
];

const soilProperties = [
  ["texture", "Textura"], ["depth", "Profundidad efectiva"], ["capacity", "Capacidad de almacenamiento hídrico"],
  ["moisture", "Humedad inicial"], ["rootDepth", "Profundidad radicular"], ["fieldCapacity", "Capacidad de campo"],
  ["wiltingPoint", "Punto de marchitez permanente"],
];

const soilFields = [
  ["value", "Valor"], ["unit", "Unidad"], ["source", "Fuente"], ["date", "Fecha (opcional)", { type: "date" }],
  ["basis", "Condición", { options: ["Medición", "Dato declarado", "Supuesto"] }],
];

const historyFields = [
  ["crop", "Cultivo previo"], ["season", "Campaña"], ["yield", "Rendimiento observado"], ["unit", "Unidad original"],
  ["fallow", "Barbechos"], ["residue", "Rastrojos"], ["management", "Manejo relevante"], ["notes", "Observaciones", { multiline: true }],
];

function completion(started, complete, review = false) {
  if (review) return "Pendiente de revisión";
  if (complete) return "Cargado";
  return started ? "Parcialmente cargado" : "Sin información";
}

function ParcelCompleteness({ draft }) {
  const hasValue = (entry) => Object.entries(entry).some(([key, value]) => key !== "id" && String(value ?? "").trim());
  const identity = validIdentity(draft.identity);
  const soil = Object.values(draft.soil).filter(hasValue);
  const history = draft.history.filter(hasValue);
  const prices = draft.prices.filter(hasValue);
  const costs = draft.costs.filter(hasValue);
  const areas = [
    ["Identificación", "#parcela/identificacion", completion(hasValue(draft.identity),
      ["name", "area", "province", "production", "firstYear", "lastYear"].every((key) => identity[key]),
      Object.keys(validateIdentity(draft.identity)).length > 0 || identity.production === "Con riego")],
    ["Caracterización del suelo", "#parcela/suelo", completion(soil.length,
      soilProperties.every(([key]) => draft.soil[key]?.value?.trim() && draft.soil[key]?.unit?.trim() && draft.soil[key]?.source?.trim()),
      soil.some(({ basis }) => basis === "Supuesto"))],
    ["Estudios de suelo", "#parcela/laboratorio", completion(draft.studies.length,
      draft.studies.length > 0 && draft.studies.every((study) => studyReviewLabel(study) === "Revisado manualmente"),
      draft.studies.some((study) => studyReviewLabel(study) === "Pendiente de revisión" ||
        (study.sampleDate && study.analysisDate && study.analysisDate < study.sampleDate)))],
    ["Antecedentes", "#parcela/antecedentes", completion(history.length || draft.historyFiles.length,
      history.some(({ crop, season }) => crop?.trim() && season?.trim()))],
    ["Precios", "#economia/precios", completion(prices.length, prices.length > 0 && prices.every((row) => !economicEntryIssue(row)))],
    ["Costos de actividades", "#economia/costos", completion(costs.length, costs.length > 0 && costs.every((row) => !economicEntryIssue(row)))],
    ["Información pendiente", "#interpretacion/advertencias", "Pendiente de revisión"],
  ];
  return <Panel title="Estado del expediente" description="Disponibilidad de los datos declarados de la parcela activa.">
    <DataTable caption="Secciones del expediente" columns={["Sección", "Estado"]} rows={areas.filter(([label])=>!["Caracterización del suelo","Precios","Costos de actividades","Información pendiente"].includes(label)).map(([label, href, state]) => ({
      id: label, cells: [<a className="work-link" href={href}>{label}</a>, state],
    }))} />
  </Panel>;
}

export default function ParcelWorkspace({ section, parcels, parcel, onSelectParcel, draft, patch, engine }) {
  if (section === "mapa") return (
    <Panel title="Mapa de parcelas" description="Imagen aérea ilustrativa. Los contornos permiten identificar las parcelas ficticias.">
      <ParcelMap parcels={parcels} activeParcelId={parcel.id} onSelect={onSelectParcel} />
    </Panel>
  );
  if (section === "laboratorio") return <LabStudies key={parcel.id} studies={draft.studies} onChange={(studies) => patch({ studies })} />;
  if (section === "suelo") return <SoilInputs draft={draft} patch={patch} />;
  if (section === "antecedentes") return (
    <Panel title="Antecedentes declarados" description="Información de referencia del lote. Las entradas se conservan mientras dure la sesión."
      actions={<button type="button" className="work-button primary" onClick={() => patch({ history: [...draft.history, { id: crypto.randomUUID() }] })}>Agregar antecedente</button>}>
      {draft.history.length === 0 && <p className="work-empty">Sin antecedentes declarados.</p>}
      {draft.history.map((record, index) => <fieldset className="work-fieldset" key={record.id}><legend>{record.crop || `Antecedente ${index + 1}`}</legend>
        <FieldGrid fields={historyFields} values={record} onChange={(key, value) => patch({ history: updateRecord(draft.history, record.id, { [key]: value }) })} />
        <button type="button" className="work-button" onClick={() => patch({ history: draft.history.filter(({ id }) => id !== record.id) })}>Quitar antecedente</button>
      </fieldset>)}
      <LocalFiles key={parcel.id} files={draft.historyFiles} onChange={(historyFiles) => patch({ historyFiles })} label="Seleccionar referencias del lote" />
    </Panel>
  );
  return (
    <>
    <PreparationReview draft={draft} economy={engine?.simulation.economy} /><ParcelCompleteness draft={draft} />
    <Panel title="Identificación del lote" description="Datos declarados para la parcela activa. Podés dejar campos sin informar mientras preparás el análisis.">
      <FieldGrid fields={identityFields} values={draft.identity} errors={validateIdentity(draft.identity)}
        onChange={(key, value) => patch({ identity: { ...draft.identity, [key]: value } })} />
      {draft.identity.production === "Con riego" && <Status tone="warning">El MVP solo representa sistemas de secano. Los escenarios de ejemplo no incluyen riego.</Status>}
      <p className="work-note">Los campos válidos se reflejan en la ficha y el informe. Las cifras ficticias quedan como referencia independiente.</p>
    </Panel>
    </>
  );
}

