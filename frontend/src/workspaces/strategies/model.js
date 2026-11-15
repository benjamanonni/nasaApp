export const stageKinds = [
  ["commercial", "Cultivo comercial"], ["cover", "Cultivo de cobertura"],
  ["fallow", "Barbecho"], ["management", "Otro manejo documentado"],
];

export const crops = [
  ["maize", "Maíz"], ["soy-first", "Soja de primera"], ["soy-second", "Soja de segunda"],
  ["wheat", "Trigo"], ["rye", "Centeno de cobertura"], ["custom", "Otro cultivo"],
];

export const operationTypes = ["Siembra", "Cosecha", "Terminación de cobertura", "Inicio de barbecho",
  "Final de barbecho", "Fertilización declarada", "Otra actividad de manejo"];

const templateKinds = { maize: "commercial", fallow: "fallow", rye: "cover", wheat: "commercial", soy: "commercial" };
const templateCrop = { maize: "maize", rye: "rye", wheat: "wheat" };
export const initialComparison = ["A", "B", "C"];

// Demonstration declarations of the three templates. They reproduce the documented example of the
// contract 1.0 (backend/app/data/examples/simulation_request.json): inputs to run the demo, not
// calibrated values. Every other parameter is left empty so the backend applies its reference.
export const DEMO_SOURCE = "Ejemplo del contrato 1.0 · sin calibrar";
const declared = (value, unit) => ({ value, unit, source: DEMO_SOURCE, basis: "Supuesto del usuario" });
const sowing = (window_year, day, month) => ({ window_year, day, month });
const durations = (initial, development, mid, late) => ({ initial, development, mid, late });
const templateAgronomy = {
  maize: { sowing: sowing("1", "15", "10"), ym: declared("9", "t/ha"), residue: declared("60", "%") },
  rye: { sowing: sowing("1", "1", "4"), durations: durations("20", "40", "40", "20"), durationSource: DEMO_SOURCE, residue: declared("80", "%") },
  "soy-first": { sowing: sowing("2", "15", "11"), ym: declared("3.2", "t/ha"), residue: declared("30", "%") },
  wheat: { sowing: sowing("1", "1", "6"), durations: durations("25", "55", "70", "35"), durationSource: DEMO_SOURCE, ym: declared("3.5", "t/ha") },
  "soy-second": { sowing: sowing("2", "3", "12"), durations: durations("15", "25", "50", "20"), durationSource: DEMO_SOURCE, ym: declared("2", "t/ha") },
};

export function strategyTemplates(rotations, parcel) {
  return rotations.map((rotation) => ({
    id: rotation.id,
    name: ({ A: "Barbecho", B: "Cobertura", C: "Doble cultivo" })[rotation.id],
    sequence: rotation.sequence,
    parcelId: parcel.id,
    isTemplate: true,
    reviewStatus: "template",
    calculationStatus: "demonstration",
    stages: rotation.phases.map(({ tone, name, note }, index) => {
      const cropId = tone === "soy" ? ({ A: "soy-first", B: "soy-first", C: "soy-second" })[rotation.id] : templateCrop[tone] || "";
      return { id: `${rotation.id}-${index}`, kind: templateKinds[tone], name, cropId, operations: [], notes: note,
        ...(templateAgronomy[cropId] ? { agronomy: templateAgronomy[cropId] } : {}) };
    }),
  }));
}

export function blankStrategy(parcelId, id) {
  return { id, parcelId, name: "", description: "", isTemplate: false, firstCampaign: "", lastCampaign: "",
    startDate: "", endDate: "", stages: [], reviewStatus: "draft", calculationStatus: "not_calculated", notes: "" };
}

export function blankStage(id) {
  return { id, kind: "commercial", cropId: "", customCropName: "", startDate: "", endDate: "", operations: [], notes: "" };
}

export function duplicateStrategy(source, makeId) {
  return {
    ...blankStrategy(source.parcelId, makeId()),
    initialResidue: source.initialResidue ? { ...source.initialResidue } : undefined,
    name: `${source.name} · copia`, description: source.description || "", notes: source.notes || "",
    firstCampaign: source.firstCampaign || "", lastCampaign: source.lastCampaign || "",
    startDate: source.startDate || "", endDate: source.endDate || "",
    stages: source.stages.map(({ name, ...stage }) => ({
      ...stage, id: makeId(), management: stage.management || (stage.kind === "management" ? name : ""),
      operations: stage.operations.map((operation) => ({ ...operation, id: makeId() })),
    })),
  };
}

export function cropOptions(stage) {
  return stage.kind === "cover"
    ? crops.filter(([id]) => id === "rye" || id === "custom")
    : [...crops.filter(([id]) => id !== "rye"), ...(stage.cropId === "soy" ? [["soy", "Soja"]] : [])];
}

export function stageName(stage) {
  if (stage.name) return stage.name;
  if (stage.kind === "fallow") return "Barbecho";
  if (stage.kind === "management") return stage.management?.trim() || "Manejo sin identificar";
  if (stage.cropId === "custom") return stage.customCropName?.trim() || "Cultivo sin identificar";
  return crops.find(([id]) => id === stage.cropId)?.[1] || (stage.cropId === "soy" ? "Soja" : "Cultivo sin identificar");
}

export function sequenceText(strategy) {
  return strategy.sequence || strategy.stages.map(stageName).join(" → ") || "Sin etapas";
}

export function strategyHorizon(strategy) {
  return strategy.firstCampaign && strategy.lastCampaign
    ? `Campañas ${strategy.firstCampaign}–${strategy.lastCampaign}`
    : strategy.isTemplate ? "Dos campañas · ejemplo" : "Horizonte pendiente";
}

export function reviewLabel(strategy) {
  if (strategy.reviewStatus === "template") return "Plantilla de ejemplo";
  return strategy.reviewStatus === "draft" ? "Borrador" : "Calendario pendiente de revisión agronómica";
}

export function calculationLabel(strategy) {
  if (strategy.calculationStatus === "demonstration") return "Plantilla ejecutable con el motor";
  return strategy.stages.some(({ cropId }) => cropId === "custom")
    ? "Sin modelo disponible para esta especie"
    : "Calculable al ejecutar la simulación";
}

export function dateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date.getTime();
}

export function orderStages(stages) {
  return [...stages].sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999"));
}

export function validateStrategy(strategy) {
  const errors = {};
  const stageErrors = {};
  if (!strategy.name.trim()) errors.name = "Ingresá un nombre.";
  const first = strategy.firstCampaign;
  const last = strategy.lastCampaign;
  if (!/^\d{4}$/.test(first) || Number(first) < 1900) errors.firstCampaign = "Ingresá un año de inicio válido.";
  if (!/^\d{4}$/.test(last) || Number(last) !== Number(first) + 1) errors.lastCampaign = "Ingresá la segunda campaña consecutiva.";
  const start = dateTime(strategy.startDate);
  const end = dateTime(strategy.endDate);
  if (start === null) errors.startDate = "Ingresá una fecha válida.";
  if (end === null || (start !== null && end <= start)) errors.endDate = "Ingresá una fecha posterior al inicio.";
  if (start !== null && strategy.startDate.slice(0, 4) !== first) errors.startDate = "El inicio debe estar en el año de la primera campaña.";
  if (end !== null && Number(strategy.endDate.slice(0, 4)) !== Number(last) && Number(strategy.endDate.slice(0, 4)) !== Number(last) + 1) {
    errors.endDate = "El fin debe estar en el año de la segunda campaña o en el siguiente.";
  }
  if (!strategy.stages.length) errors.stages = "Agregá al menos una etapa.";
  for (const stage of strategy.stages) {
    const fields = {};
    const stageStart = dateTime(stage.startDate);
    const stageEnd = dateTime(stage.endDate);
    if (stageStart === null || (start !== null && stageStart < start)) fields.startDate = "Ingresá una fecha de inicio dentro del horizonte.";
    if (stageEnd === null || (stageStart !== null && stageEnd <= stageStart) || (end !== null && stageEnd > end)) {
      fields.endDate = "Ingresá una fecha posterior al inicio y dentro del horizonte.";
    }
    if (stage.kind === "management" && !stage.management?.trim()) fields.management = "Identificá el manejo.";
    if (["commercial", "cover"].includes(stage.kind)) {
      if (!cropOptions(stage).some(([id]) => id === stage.cropId)) fields.cropId = "Seleccioná un cultivo.";
      if (stage.cropId === "custom" && !stage.customCropName?.trim()) fields.customCropName = "Ingresá el nombre del cultivo.";
    }
    for (const operation of stage.operations) {
      if (!operationTypes.includes(operation.type)) fields[`${operation.id}-type`] = "Seleccioná una operación.";
      const date = dateTime(operation.date);
      if (date === null || (stageStart !== null && date < stageStart) || (stageEnd !== null && date > stageEnd)) {
        fields[`${operation.id}-date`] = "Ingresá una fecha dentro de la etapa.";
      }
      if (operation.type === "Otra actividad de manejo" && !operation.description?.trim()) {
        fields[`${operation.id}-description`] = "Describí la actividad.";
      }
    }
    if (Object.keys(fields).length) stageErrors[stage.id] = fields;
  }
  const dated = orderStages(strategy.stages).filter(({ startDate, endDate }) => dateTime(startDate) !== null && dateTime(endDate) !== null);
  const overlaps = dated.flatMap((stage, index) => dated.slice(index + 1).filter(({ startDate }) => startDate < stage.endDate)
    .map((other) => `${stageName(stage)} / ${stageName(other)}`));
  return { errors, stageErrors, overlaps, valid: !Object.keys(errors).length && !Object.keys(stageErrors).length };
}

export function saveStrategy(strategy) {
  const { id, name, description, parcelId, firstCampaign, lastCampaign, startDate, endDate, stages, notes, initialResidue } = strategy;
  return { id, name: name.trim(), description, parcelId, firstCampaign, lastCampaign, startDate, endDate,
    stages: orderStages(stages), notes, initialResidue, isTemplate: false, reviewStatus: "pending", calculationStatus: "not_calculated" };
}

export function toggleComparison(ids, id) {
  if (ids.includes(id)) return ids.filter((item) => item !== id);
  return ids.length < 3 ? [...ids, id] : ids;
}

export function sameHorizon(a, b) {
  return a.firstCampaign === b.firstCampaign && a.lastCampaign === b.lastCampaign &&
    a.startDate === b.startDate && a.endDate === b.endDate;
}

export function comparisonContext(strategies) {
  const reference = strategies.find((strategy) => !strategy.isTemplate && strategy.reviewStatus !== "draft");
  if (!reference) return { reference, incompatible: [], undated: strategies.filter(({ isTemplate }) => !isTemplate) };
  return {
    reference,
    incompatible: strategies.filter((strategy) => !strategy.isTemplate && strategy.reviewStatus !== "draft" && !sameHorizon(reference, strategy)),
    undated: strategies.filter(({ isTemplate, reviewStatus }) => isTemplate || reviewStatus === "draft"),
  };
}

