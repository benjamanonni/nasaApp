import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StrategyLibrary from "../src/workspaces/strategies/StrategyLibrary.jsx";
import StrategyComparison from "../src/workspaces/strategies/StrategyComparison.jsx";
import { rotations } from "../src/data/demo.js";
import { parcels } from "../src/data/parcels.js";
import { blankStrategy, calculationLabel, comparisonContext, duplicateStrategy, saveStrategy, strategyTemplates,
  toggleComparison, validateStrategy } from "../src/workspaces/strategies/model.js";
import { updateParcelDraft } from "../src/workspaces/session.js";

const parcel = parcels[1];
const templates = strategyTemplates(rotations, parcel);
const demoResults = rotations.map((rotation) => ({ ...rotation, ...parcel.scenarios[rotation.id] }));
const example = {
  ...blankStrategy(parcel.id, "custom-1"), name: "Ensayo de cobertura", firstCampaign: "2026", lastCampaign: "2027",
  startDate: "2026-09-01", endDate: "2028-06-30",
  stages: [
    { id: "stage-1", kind: "commercial", cropId: "custom", customCropName: "Sorgo", startDate: "2026-11-01", endDate: "2027-03-30",
      operations: [{ id: "op-1", type: "Siembra", date: "2026-11-02" }] },
    { id: "stage-2", kind: "fallow", startDate: "2027-03-20", endDate: "2027-05-31", operations: [] },
  ],
};

describe("Dynamic strategies", () => {
  it("retains the three templates and admits arbitrary additional strategies by parcel", () => {
    const north = updateParcelDraft({}, parcel.id, () => ({ strategies: Array.from({ length: 6 }, (_, index) => ({
      ...saveStrategy(example), id: `custom-${index}`, name: `Ensayo ${index}`,
    })) }));
    const mixed = updateParcelDraft(north, "P-01", () => ({ strategies: [] }));
    const html = renderToStaticMarkup(<StrategyLibrary strategies={[...templates, ...mixed[parcel.id].strategies]} comparisonIds={["A","B","C"]} />);

    expect(templates.map(({ id }) => id)).toEqual(["A", "B", "C"]);
    expect(new Set(mixed[parcel.id].strategies.map(({ id }) => id)).size).toBe(6);
    expect(html).toContain("Ensayo 5");
    expect(mixed["P-01"].strategies).toHaveLength(0);
  });

  it("duplicates stage and operation identifiers and drops results from another revision", () => {
    let count = 0;
    const copy = duplicateStrategy({ ...example, calculationStatus: "calculated", results: { yield: 10 } }, () => `id-${++count}`);
    expect(copy.id).not.toBe(example.id);
    expect(copy.stages[0].id).not.toBe(example.stages[0].id);
    expect(copy.stages[0].operations[0].id).not.toBe(example.stages[0].operations[0].id);
    expect(copy).not.toHaveProperty("results");
    const saved = saveStrategy({ ...example, results: {}, calculationStatus: "calculated" });
    expect(saved.calculationStatus).toBe("not_calculated");
    expect(saved).not.toHaveProperty("results");
  });

  it("warns about overlapping stages but rejects dates and operations outside the horizon", () => {
    const check = validateStrategy(example);
    expect(check.valid).toBe(true);
    expect(check.overlaps).toEqual(["Sorgo / Barbecho"]);
    const invalid = { ...example, stages: [{ ...example.stages[0], endDate: "2029-02-01",
      operations: [{ ...example.stages[0].operations[0], date: "2026-10-10" }] }] };
    expect(validateStrategy(invalid).stageErrors["stage-1"]).toHaveProperty("endDate");
    expect(validateStrategy(invalid).stageErrors["stage-1"]).toHaveProperty("op-1-date");
  });

  it("caps the comparison and excludes incompatible or undated horizons from the common axis", () => {
    expect(toggleComparison(["A", "B", "C"], example.id)).toEqual(["A", "B", "C"]);
    expect(toggleComparison(toggleComparison(["A", "B", "C"], "A"), example.id)).toEqual(["B", "C", example.id]);
    const saved = saveStrategy(example);
    const different = { ...saved, id: "other", startDate: "2026-10-01" };
    expect(comparisonContext([templates[0], saved, different])).toMatchObject({ reference: saved, incompatible: [different], undated: [templates[0]] });
  });

  it("shows missing economic results for custom crops and renders only chosen demonstration strategies", () => {
    const custom = saveStrategy(example);
    const html = renderToStaticMarkup(<StrategyComparison strategies={[...templates, custom]}
      comparisonIds={["A", "C", custom.id]} inspection={{ strategyId: custom.id }} demoResults={demoResults} scenario="Histórico · ejemplo" />);
    expect(calculationLabel(custom)).toContain("Sin modelo disponible");
    expect(html).toContain("Resultados económicos pendientes de cálculo");
    expect(html).toContain("2026-09-01");
    expect(html).not.toContain("600.000");
    expect(html.match(/class="barrow"/g)).toHaveLength(2);
  });
});

