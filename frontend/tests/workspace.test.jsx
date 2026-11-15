import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../src/App.jsx";
import Inspector from "../src/components/Inspector.jsx";
import MetricsPanel from "../src/components/MetricsPanel.jsx";
import ParcelMap from "../src/components/ParcelMap.jsx";
import ParcelSidebar from "../src/components/ParcelSidebar.jsx";
import { initialViewport, panViewport, zoomViewport } from "../src/components/mapViewport.js";
import { declaredParcelFacts, emptyDraft, exportDraft, parcelWithIdentity } from "../src/workspaces/session.js";
import { strategyTemplates } from "../src/workspaces/strategies/model.js";
import { rotations } from "../src/data/demo.js";
import { initialParcelId, parcels } from "../src/data/parcels.js";

const onSelect = () => {};

describe("AgroDSS workspace", () => {
  it("starts with comparison, with Parcela Central and three strategies selected", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Mesa comparativa");
    expect(html).not.toContain('class="map-surface"');
    expect(html).not.toContain("Dos campañas, tres estrategias");
    expect(html).not.toContain('id="parcel-tab-sequence"');
    expect(html).toContain("Cronología agrícola");
    expect(html).not.toContain("main-num");
    expect(html).not.toContain('id="parcel-context"');
    expect(html).toContain("Abrir inspector");
    expect(html).toContain("DATOS FICTICIOS");
    expect(html).toContain("Horizonte de indicadores");
    expect(html).not.toContain("Primera campaña</option>");
    expect(html).toContain("3 de 3 seleccionadas");
  });

  it.each(parcels)("renders $name's selected strategy and matching comparison values", (parcel) => {
    const parcelRotations = rotations.map((rotation) => ({ ...rotation, ...parcel.scenarios[rotation.id] }));

    for (const scenario of parcelRotations) {
      const html = renderToStaticMarkup(
        <>
          <Inspector parcel={parcel} strategy={strategyTemplates(rotations, parcel).find(({ id }) => id === scenario.id)} inspection={{}} onClose={onSelect} />
          <MetricsPanel parcelName={parcel.name} rotations={parcelRotations} selectedId={scenario.id} />
        </>,
      );

      expect(html).toContain("Inspector contextual");
      expect(html).not.toContain("Margen bruto ilustrativo");
      expect(html).toContain(`class="barrow selected"><div class="name">Estrategia ${scenario.id}`);
      expect(html).toContain(`class="bar-val">${scenario.margin.toLocaleString("es-AR")}</div>`);
    }
  });

  it("keeps the indicator tabs, assumptions and parcel-specific print data", () => {
    const html = renderToStaticMarkup(<App />);

    const indicators = renderToStaticMarkup(<MetricsPanel rotations={rotations.map((rotation) => ({ ...rotation, ...parcels[1].scenarios[rotation.id] }))}
      selectedId="B" parcelName="Parcela Central" />);
    for (const label of ["Economía", "Agua", "Suelo", "Producción"]) {
      expect(indicators).toMatch(new RegExp(`role="tab"[^>]*aria-controls="metric-panel"[^>]*>${label}</button>`));
    }

    expect(indicators).toContain('role="tabpanel" aria-labelledby="tab-economy"');
    expect(html).toContain("Estrategias seleccionadas en la mesa");
    expect(html).toContain('aria-labelledby="modalTitle"');
    expect(html).toContain("Indicadores disponibles · Referencia de ejemplo · Dos campañas");
  });
});

describe("Parcel map", () => {
  it.each([initialParcelId, "P-01", "P-03"])("renders three keyboard-reachable polygons and selects %s", (activeParcelId) => {
    const html = renderToStaticMarkup(<ParcelMap parcels={parcels} activeParcelId={activeParcelId} onSelect={onSelect} />);

    expect(html.match(/<polygon [^>]*data-parcel=/g)).toHaveLength(3);
    expect(html.match(/role="button" tabindex="0"/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`data-parcel="${activeParcelId}"[^>]*aria-pressed="true"`));
    expect(html).toContain('aria-label="Parcelas ficticias"');
  });

  it("applies drag displacement, limits zoom and resets offsets at the base zoom", () => {
    const zoomed = zoomViewport(initialViewport, 0.25);
    const dragged = panViewport(zoomed, { clientX: 25, clientY: 40, originX: 0, originY: 0 }, { clientX: 60, clientY: 20 });

    expect(dragged).toEqual({ zoom: 1.3, x: 35, y: -20 });
    expect(zoomViewport(dragged, 20)).toEqual({ zoom: 2.4, x: 35, y: -20 });
    expect(zoomViewport(dragged, -0.4)).toEqual(initialViewport);
  });
});

describe("Parcel sidebar", () => {
  it.each(parcels)("shows $name's facts and the same polygon as the map", (parcel) => {
    const html = renderToStaticMarkup(<ParcelSidebar parcel={parcelWithIdentity(parcel, {})} facts={declaredParcelFacts(emptyDraft)} onReview={onSelect} />);

    expect(html).toContain("<h3>Parcela de análisis</h3>");
    expect(html).toContain("<span>Superficie</span><strong>Sin informar</strong>");
    expect(html).not.toContain(parcel.area);
    expect(html).toContain(`<polygon points="${parcel.points}"`);
  });
});


it("rejects invalid identity in the export while preserving editable draft input", () => {
  const draft = { ...emptyDraft, identity: { name: "Lote real", firstYear: "sdsd", lastYear: "2028", area: "" } };
  const exported = exportDraft(draft);
  expect(draft.identity.firstYear).toBe("sdsd");
  expect(exported.identity).toEqual({ name: "Lote real", lastYear: "2028" });
  expect(parcelWithIdentity(parcels[1], draft.identity).name).toBe("Lote real");
  expect(declaredParcelFacts(draft)[0][1]).toBe("Sin informar");
});
