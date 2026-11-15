import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Navigation from "../src/components/Navigation.jsx";
import WorkspaceHeader from "../src/components/WorkspaceHeader.jsx";
import { rotations } from "../src/data/demo.js";
import { parcels } from "../src/data/parcels.js";
import { createSimulationRunner } from "../src/services/api.js";
import { demoPreparation } from "../src/workspaces/preparation.js";
import { ReportContent } from "../src/workspaces/ReportWorkspace.jsx";
import { emptyDraft } from "../src/workspaces/session.js";
import { exampleSimulation, simulationContext, startSimulation } from "../src/workspaces/simulation.js";
import { SimulationRunPanel } from "../src/workspaces/SimulationResults.jsx";
import { initialComparison, strategyTemplates } from "../src/workspaces/strategies/model.js";
import { readRoute, workspaces } from "../src/workspaces/routes.js";

const parcel = parcels[0];
const strategies = strategyTemplates(rotations, parcel);
const makeContext = (draft) => simulationContext({ parcel, draft, strategies, comparisonIds: initialComparison });
const renderPanel = (simulation) => renderToStaticMarkup(
  <SimulationRunPanel simulation={simulation} onRun={() => {}} onRunExample={() => {}} onCheckService={() => {}} />,
);

describe("single-action simulation", () => {
  it("submits the validated draft directly with an internal health check", async () => {
    const draft = { ...emptyDraft, ...demoPreparation(emptyDraft) };
    const context = makeContext(draft);
    const check = vi.fn().mockResolvedValue({ status: "ok" });
    const submit = vi.fn().mockResolvedValue({ results: [] });
    const save = vi.fn();
    expect(renderPanel(context)).toContain("Listo para ejecutar");
    expect(renderPanel(context)).toContain(">Ejecutar simulación</button>");
    expect(renderPanel(context)).toContain('<details class="simulation-diagnostics">');
    await startSimulation({ parcelId: parcel.id, context, run: createSimulationRunner({ check, submit }), save });
    expect(check).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledExactlyOnceWith(context.request);
    expect(save.mock.lastCall[0].simulationRun.status).toBe("done");
  });

  it("constructs one complete example payload and saves its inputs together with the run", async () => {
    const initial = renderPanel(makeContext(emptyDraft));
    expect(initial).toContain("Probar con un caso de ejemplo");
    expect(initial).not.toContain(">Ejecutar simulación</button>");
    const confirm = vi.fn();
    const plan = exampleSimulation({ parcel, draft: emptyDraft, strategies }, confirm);
    const submit = vi.fn().mockResolvedValue({ results: [] });
    const save = vi.fn();
    const run = createSimulationRunner({ check: async () => ({}), submit });
    const start = () => startSimulation({ parcelId: parcel.id, ...plan, run, save, example: true });
    await Promise.all([start(), start()]);
    expect(confirm).not.toHaveBeenCalled();
    expect(plan.context.issues).toEqual([]);
    expect(submit).toHaveBeenCalledTimes(1);
    const [payload] = submit.mock.calls[0];
    expect(payload.window.start_years).toEqual([2008, 2011, 2017]);
    expect(payload.parcel.latitude_deg).toBe(-33.68);
    expect(payload.rotations.map(({ id }) => id)).toEqual(initialComparison);
    expect(save.mock.calls[0][0]).toMatchObject({
      identity: { latitude: "-33.68" },
      simulationRun: { example: true, request: payload, phase: "connecting" },
    });
  });

  it("renders the report immediately after applying the example without an optional fallow value", () => {
    const partial = { ...emptyDraft, soil: { fallowKc: { value: "0.5" } } };
    const { changes } = exampleSimulation({ parcel, draft: partial, strategies }, () => true);
    expect(changes.soil).not.toHaveProperty("fallowKc");
    const html = renderToStaticMarkup(<ReportContent parcel={parcel} referenceParcel={parcel}
      draft={{ ...partial, ...changes }} strategies={strategies} comparisonIds={initialComparison}
      parcelRotations={[]} selected={strategies[0]} scenario="Histórico · ejemplo" />);
    expect(html).toContain("Propiedades con unidad y fuente");
  });

  it("links to incomplete inputs and preserves them when example replacement is declined", async () => {
    const draft = { ...emptyDraft, identity: { latitude: "-34" } };
    const context = makeContext(draft);
    const markup = renderPanel(context);
    const run = vi.fn();
    expect(markup).toContain("Completar datos para simular");
    for (const href of ["#parcela/identificacion", "#parcela/suelo", "#estrategias/clima"]) {
      expect(markup).toContain('href="' + href + '"');
    }
    expect(exampleSimulation({ parcel, draft, strategies }, () => false)).toBeNull();
    await startSimulation({ parcelId: parcel.id, context, run, save: vi.fn() });
    expect(run).not.toHaveBeenCalled();
    expect(draft.identity.latitude).toBe("-34");
  });

  it("keeps entered fields when the backend cannot be reached", async () => {
    const draft = { ...emptyDraft, ...demoPreparation(emptyDraft) };
    const context = makeContext(draft);
    const submit = vi.fn();
    const save = vi.fn();
    const run = createSimulationRunner({ check: async () => { throw Error("Offline"); }, submit });
    await startSimulation({ parcelId: parcel.id, context, run, save });
    const updates = save.mock.calls.map(([update]) => update);
    expect(updates.every((update) => !Object.hasOwn(update, "identity"))).toBe(true);
    expect(updates.at(-1).simulationRun.error.message).toContain("todavía no se envió");
    expect(submit).not.toHaveBeenCalled();
  });
});

it("removes the header scenario without changing historical configuration or mobile navigation", () => {
  const header = renderToStaticMarkup(<WorkspaceHeader parcels={parcels} activeParcel={parcel}
    rotations={strategies} activeStrategy={strategies[0]} localStrategyControls periodLabel="Dos campañas" />);
  expect(header).not.toMatch(/Escenario|Histórico · ejemplo/);
  expect(header).toContain("Parcela activa");
  expect(readRoute("#estrategias/clima").section).toBe("clima");
  const nav = renderToStaticMarkup(<Navigation activeWorkspace="estrategias" />).split('class="mobile-workspaces"')[1];
  expect(nav).toContain("Espacios de trabajo");
  for (const { id, sections } of workspaces) expect(nav).toContain('href="#' + id + "/" + sections[0][0] + '"');
});
