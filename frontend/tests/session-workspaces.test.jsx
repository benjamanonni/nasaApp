import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readRoute } from "../src/workspaces/routes.js";
import { acceptedFiles, emptyDraft, exportDraft, studyReviewLabel, updateParcelDraft, validateIdentity } from "../src/workspaces/session.js";
import { StudyResults } from "../src/workspaces/LabStudies.jsx";
import { getWarnings } from "../src/workspaces/InterpretationWorkspace.jsx";
import { EconomicComparison } from "../src/workspaces/EconomyWorkspace.jsx";
import { parcels } from "../src/data/parcels.js";
import { rotations } from "../src/data/demo.js";

describe("Workspace navigation", () => {
  it("resolves interpretation evidence separately from editor strategy IDs", () => {
    expect(readRoute("#interpretacion/resultados/deficit")).toMatchObject({ section: "resultados", indicatorId: "deficit", strategyId: undefined });
    expect(readRoute("#estrategias/editor/custom/detalle")).toMatchObject({ section: "editor", strategyId: "custom", detail: true });
  });

  it.each([
    ["#parcela/laboratorio", "parcela", "laboratorio"],
    ["#estrategias/cronologia", "estrategias", "cronologia"],
    ["#economia/costos", "economia", "costos"],
    ["#interpretacion/nutricion", "interpretacion", "nutricion"],
    ["#informe/gestion", "informe", "gestion"],
    ["#constructor", "estrategias", "comparar"],
    ["#estrategias/alternativas", "estrategias", "comparar"],
    ["#rotations", "estrategias", "comparar"],
    ["#parcela/desconocida", "parcela", "identificacion"],
  ])("resolves %s", (hash, workspace, section) => {
    expect(readRoute(hash)).toMatchObject({ workspace: { id: workspace }, section });
  });
});

describe("Session data integrity", () => {
  it("keys drafts by parcel and exports only attachment metadata", () => {
    const report = { id: "report-1", files: [{ name: "lab.csv", size: 42, type: "text/csv", raw: "secret contents" }], samples: [] };
    const north = updateParcelDraft({}, "P-01", () => ({ studies: [report], prices: [{ amount: "120", unit: "USD/t" }] }));
    const both = updateParcelDraft(north, "P-02", () => ({ identity: { area: "88" } }));

    expect(both["P-02"].studies).toEqual([]);
    expect(both["P-01"].studies).toEqual([report]);
    expect(exportDraft(both["P-01"]).studies[0].files).toEqual([{ name: "lab.csv", size: 42, type: "text/csv" }]);
    expect(both["P-01"].prices[0].amount).toBe("120");
  });

  it("checks basic format and ignores unknown or empty attachments", () => {
    expect(validateIdentity({ area: "-1", latitude: "93", firstYear: "2026", lastYear: "2025" })).toHaveProperty("lastYear");
    expect(validateIdentity({ area: "88", longitude: "-66.3", firstYear: "2025", lastYear: "2026" })).toEqual({});
    expect(acceptedFiles([{ name: "a.PNG", size: 1 }, { name: "b.pdf", size: 0 }, { name: "c.txt", size: 8 }], ["png", "pdf"]))
      .toEqual({ clean: [{ name: "a.PNG", size: 1 }], rejected: 2 });
  });

  it("treats laboratory values as original text, preserving analytes, depths, units and review", () => {
    const study = { id: "1", report: "LAB-22", files: [], samples: [
      { id: "north", name: "Superior", depth: "0–20", depthUnit: "cm", results: [{ id: "r1", group: "nitrogen", name: "N-NO₃", value: "12", unit: "mg/kg", review: "Revisado manualmente" }] },
      { id: "deep", name: "Profunda", depth: "20–40", depthUnit: "cm", results: [{ id: "r2", group: "nitrogen", name: "NO₃", value: "60", unit: "ppm" }] },
    ] };
    const html = renderToStaticMarkup(<StudyResults studies={[study]} />);
    expect(html).toContain("Superior</td><td>0–20 cm</td><td>N-NO₃</td><td>12</td><td>mg/kg");
    expect(html).toContain("Profunda</td><td>20–40 cm</td><td>NO₃</td><td>60</td><td>ppm");
    expect(html).toContain("Revisado manualmente");
    expect(studyReviewLabel({ samples: [] })).toBe("Pendiente de transcripción");
  });

  it("keeps the invalid laboratory date for editing and excludes it from the exported record", () => {
    const study = { id: "1", files: [], samples: [], sampleDate: "2026-06-10", analysisDate: "2026-06-01" };
    const draft = { ...emptyDraft, studies: [study] };
    expect(getWarnings(draft).some(([name]) => name === "Fecha inválida")).toBe(true);
    expect(exportDraft(draft).studies[0]).not.toHaveProperty("analysisDate");
    expect(draft.studies[0].analysisDate).toBe("2026-06-01");
  });

  it("distinguishes data warnings from unavailable calculations", () => {
    const warnings = getWarnings({ ...emptyDraft, identity: { production: "Con riego" },
      costs: [{ amount: "-1" }], soil: { moisture: { value: "99", basis: "Supuesto" } } });
    expect(warnings.map(([label]) => label)).toEqual(expect.arrayContaining([
      "Dato faltante", "Unidad por revisar", "Importe inválido", "Estado del cálculo", "Parámetro supuesto", "Fuera del alcance actual",
    ]));
  });

  it("shows the predefined economic comparison with the original demo values", () => {
    const declared = { prices: [{ amount: "321" }], costs: [{ amount: "234" }] };
    const results = rotations.map((rotation) => ({ ...rotation, ...parcels[1].scenarios[rotation.id] }));
    const html = renderToStaticMarkup(<EconomicComparison rotations={results} selectedId="B" draft={declared} />);
    expect(html).toContain("Referencia de ejemplo · ARS/ha · Dos campañas");
    expect(html).toContain("600.000");
    expect(html).not.toContain("321");
  });
});

