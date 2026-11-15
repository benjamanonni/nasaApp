import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReportPayload, ReportContent } from "../src/workspaces/ReportWorkspace.jsx";
import { emptyDraft, parcelWithIdentity } from "../src/workspaces/session.js";
import { blankStrategy, strategyTemplates } from "../src/workspaces/strategies/model.js";
import { rotations } from "../src/data/demo.js";
import { parcels } from "../src/data/parcels.js";

describe("Comparison report", () => {
  const referenceParcel = parcels[1];
  const draft = { ...emptyDraft, identity: { name: "Lote declarado", firstYear: "sdsd", area: "-2", latitude: "95" },
    prices: [{ id: "invalid", amount: "-10", currency: "ARS", unit: "t" }, { id: "valid", amount: "340,5", currency: "ARS", unit: "t" }],
    costs: [{ id: "mixed", amount: "45", currency: "ARS", unit: "USD/ha" }] };
  const parcel = parcelWithIdentity(referenceParcel, draft.identity);
  const custom = { ...blankStrategy(parcel.id, "custom"), name: "Sorgo experimental", sequence: "Sorgo" };
  const props = { parcel, referenceParcel, draft, selected: custom, scenario: "Histórico · ejemplo", comparisonIds: ["B", custom.id],
    strategies: [...strategyTemplates(rotations, parcel), custom],
    parcelRotations: rotations.map((rotation) => ({ ...rotation, ...referenceParcel.scenarios[rotation.id] })) };

  it("reports selected alternatives only, with the entire horizon and explicit pending states", () => {
    const html = renderToStaticMarkup(<ReportContent {...props} />);
    expect(html).toContain("Lote declarado");
    expect(html).toContain("Sorgo experimental");
    expect(html).toContain("600.000");
    expect(html).not.toContain("660.000");
    expect(html).not.toContain("490.000");
    expect(html).not.toContain("sdsd");
    expect(html).toContain("Sin informar");
    expect(html).toContain("Horizonte de dos campañas");
    expect(html).toContain("Hay precios o costos declarados. Ejecutá la simulación para calcular los resultados económicos.");
  });

  it("exports selected strategy IDs, separates fixtures and excludes invalid amounts and location data", () => {
    const result = buildReportPayload(props);
    expect(result.context).toMatchObject({ comparisonIds: ["B", "custom"], period: "Dos campañas" });
    expect(result.declared.identity).toEqual({ name: "Lote declarado" });
    expect(result.declared.prices.map(({ id }) => id)).toEqual(["valid"]);
    expect(result.declared.costs).toEqual([]);
    expect(result.demonstration.comparisons.map(({ id }) => id)).toEqual(["B"]);
    expect(result.pending).toMatchObject({ economicCalculation: true, strategyIds: ["custom"], excludedPriceRows: 1, excludedCostRows: 1 });
  });
});

