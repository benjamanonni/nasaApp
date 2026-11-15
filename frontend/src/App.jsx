import { useEffect, useRef, useState } from "react";
import Navigation from "./components/Navigation.jsx";
import ParcelSidebar from "./components/ParcelSidebar.jsx";
import WorkspaceHeader from "./components/WorkspaceHeader.jsx";
import Inspector from "./components/Inspector.jsx";
import AssumptionsDialog from "./components/AssumptionsDialog.jsx";
import { rotations } from "./data/demo.js";
import { initialParcelId, parcels } from "./data/parcels.js";
import { readRoute, scenarios, strategyGroups } from "./workspaces/routes.js";
import { comparisonPeriod } from "./workspaces/comparison.js";
import { declaredParcelFacts, emptyDraft, parcelWithIdentity, updateParcelDraft } from "./workspaces/session.js";
import ParcelWorkspace from "./workspaces/ParcelWorkspace.jsx";
import ExploreWorkspace from "./workspaces/ExploreWorkspace.jsx";
import EconomicExplorer from "./workspaces/EconomicExplorer.jsx";
import { duplicateStrategy, initialComparison, sequenceText, strategyTemplates, toggleComparison } from "./workspaces/strategies/model.js";
import EconomyWorkspace from "./workspaces/EconomyWorkspace.jsx";
import InterpretationWorkspace from "./workspaces/InterpretationWorkspace.jsx";
import ReportWorkspace, { ReportContent } from "./workspaces/ReportWorkspace.jsx";
import { demoPreparation } from "./workspaces/preparation.js";
import { simulationContext } from "./workspaces/simulation.js";
import { errorSummary, getCatalog, getHealth, postSimulation } from "./services/api.js";
import cropReference from "./data/crop-reference.json";

const panels = { parcela: ParcelWorkspace, estrategias: ExploreWorkspace, economia: EconomyWorkspace,
  interpretacion: InterpretationWorkspace, informe: ReportWorkspace };

export default function App() {
  const [route, setRoute] = useState(() => readRoute(typeof window === "undefined" ? "" : window.location.hash));
  const [activeParcelId, setActiveParcelId] = useState(initialParcelId);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [parcelInspection, setParcelInspection] = useState(false);
  const [activeHistoricalScenarioId] = useState(scenarios[0][0]);
  const [drafts, setDrafts] = useState({});
  const [explorerOpen, setExplorerOpen] = useState(false);
  const restoreExplorerFocus = useRef(false);
  const [economicBaselines, setEconomicBaselines] = useState({});
  const [isReviewOpen, setReviewOpen] = useState(false);
  const [metricId, setMetricId] = useState("water");
  const [strategyNotice, setStrategyNotice] = useState(null);
  const [serviceNotice, setServiceNotice] = useState("");

  const { workspace, section } = route;
  const Workspace = panels[workspace.id];

  const referenceParcel = parcels.find(({ id }) => id === activeParcelId);
  const draft = drafts[activeParcelId] ?? emptyDraft;
  const displayParcels = parcels.map((parcel) => parcelWithIdentity(parcel, drafts[parcel.id]?.identity ?? {}));
  const parcel = displayParcels.find(({ id }) => id === activeParcelId);
  const parcelFacts = declaredParcelFacts(draft);
  const parcelRotations = rotations.map((rotation) => ({ ...rotation, ...referenceParcel.scenarios[rotation.id] }));
  const strategies = [...strategyTemplates(rotations, parcel), ...draft.strategies]
    .map((strategy) => ({ ...strategy, sequence: sequenceText(strategy) }));
  const item = strategies.find(({ id }) => id === route.strategyId);
  const storedInspection = draft.strategyInspection ?? { strategyId: "B" };
  const selection = workspace.id === "estrategias" && section === "editor" && item
    ? { strategyId: item.id } : storedInspection;
  const selected = strategies.find(({ id }) => id === selection.strategyId) ?? strategies[1];
  const sectionKey = workspace.id + "/" + section;
  const inspection = { ...selection, strategyId: selected.id,
    result: selection.resultSection === sectionKey ? selection.result : undefined };
  const comparisonIds = draft.comparisonIds ?? initialComparison;
  const simulation = simulationContext({ parcel, draft, strategies, comparisonIds });
  const showParcelContext = workspace.id === "parcela" && !inspectorOpen;
  const localStrategyControls = workspace.id === "estrategias" && ["biblioteca", "editor", "comparar", "cronologia"].includes(section);
  const group = workspace.id === "estrategias" ? strategyGroups.find(([, ids]) => ids.includes(section)) : undefined;
  const periodLabel = comparisonPeriod;
  const scenario = scenarios.find(([id]) => id === activeHistoricalScenarioId)[1];

  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash;
      if (hash === "#parcel-inspector") return;
      setExplorerOpen(false);
      setParcelInspection(false);
      setRoute(readRoute(hash));
      window.scrollTo({ top: 0, behavior: "instant" });
      document.getElementById("workspace-content")?.focus({ preventScroll: true });
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);


  const editorStrategyId = workspace.id === "estrategias" && section === "editor" ? item?.id : undefined;
  useEffect(() => {
    if (!editorStrategyId) return;
    setDrafts((previous) => {
      if (previous[activeParcelId]?.strategyInspection?.strategyId === editorStrategyId) return previous;
      return updateParcelDraft(previous, activeParcelId, () => ({ strategyInspection: { strategyId: editorStrategyId } }));
    });
  }, [activeParcelId, editorStrategyId]);

  function patch(changes) {

    setDrafts((previous) => updateParcelDraft(previous, activeParcelId, () => changes));
  }

  function snapshotEconomy(id) {
    const original = drafts[id] ?? emptyDraft;
    setEconomicBaselines((previous) => previous[id] ? previous : {
      ...previous, [id]: { prices: original.prices, costs: original.costs },
    });
  }

  function selectParcel(id) {
    if (explorerOpen) snapshotEconomy(id);
    setStrategyNotice(null);
    setActiveParcelId(id);
    setParcelInspection(workspace.id === "parcela");
  }

  function selectMapParcel(id) {
    selectParcel(id);
    setParcelInspection(true);
    setInspectorOpen(true);
  }

  function openExplorer() {
    snapshotEconomy(activeParcelId);
    setExplorerOpen(true);
  }

  function closeExplorer() {
    restoreExplorerFocus.current = true;
    setExplorerOpen(false);
  }

  useEffect(() => {
    if (!explorerOpen && restoreExplorerFocus.current) {
      restoreExplorerFocus.current = false;
      document.getElementById("economic-explorer-trigger")?.focus({ preventScroll: true });
    }
  }, [explorerOpen]);

  async function runSimulation() {
    const parcelId = activeParcelId;
    const { request, strategyMap, issues } = simulation;
    if (issues.length || simulation.status === "running") return;
    const store = (run) => setDrafts((previous) => updateParcelDraft(previous, parcelId, () => ({
      simulationRun: { request, strategyMap, response: null, error: null, executedAt: null, ...run } })));
    store({ status: "running" });
    try {
      const response = await postSimulation(request);
      store({ status: "done", response, executedAt: new Date().toISOString() });
    } catch (error) {
      store({ status: "error", error: errorSummary(error), executedAt: new Date().toISOString() });
    }
  }

  async function checkService() {
    setServiceNotice("Comprobando el servicio de cálculo…");
    try {
      const [health, catalog] = await Promise.all([getHealth(), getCatalog()]);
      const sameCatalog = catalog.catalog_version === cropReference.catalog_version;
      setServiceNotice(`Servicio disponible (${health.status}) · Catálogo ${catalog.catalog_version} con ${catalog.crops.length} cultivos` +
        (sameCatalog ? "." : ` · Distinto del catálogo local ${cropReference.catalog_version}: revisá las referencias.`));
    } catch (error) {
      const { message, requestId } = errorSummary(error);
      setServiceNotice(message + (requestId ? ` · request_id ${requestId}` : ""));
    }
  }

  function storeStrategy(strategy) {
    patch({ strategies: draft.strategies.some(({ id }) => id === strategy.id)
      ? draft.strategies.map((entry) => entry.id === strategy.id ? strategy : entry)
      : [...draft.strategies, strategy] });
  }

  function inspectStrategy(strategyId, detail = {}) {
    patch({ strategyInspection: { strategyId, ...detail, ...(detail.result ? { resultSection: sectionKey } : {}) } });
    setParcelInspection(false);
    setInspectorOpen(true);
  }

  const engine = { simulation, serviceNotice, onRun: runSimulation, onCheckService: checkService, onLoadDemo: () => patch(demoPreparation(draft)) };
  const strategyBook = {
    strategies, comparisonIds, inspection, item, details: route.detail, missingItem: Boolean(route.strategyId && !item),
    onInspect: inspectStrategy,
    notice: strategyNotice?.parcelId === parcel.id ? strategyNotice.text : "",
    onToggle: (id) => patch({ comparisonIds: toggleComparison(comparisonIds, id) }),
    onDuplicate: (strategy) => {
      const copy = duplicateStrategy(strategy, () => crypto.randomUUID());
      storeStrategy(copy);
      inspectStrategy(copy.id);
      setStrategyNotice(null);
      window.location.hash = `#estrategias/editor/${copy.id}`;
    },
    onDelete: (id) => {
      patch({ strategies: draft.strategies.filter((strategy) => strategy.id !== id),
        comparisonIds: comparisonIds.filter((selectedId) => selectedId !== id),
        ...(storedInspection.strategyId === id ? { strategyInspection: { strategyId: "B" } } : {}) });
      setStrategyNotice({ parcelId: parcel.id, text: "Estrategia eliminada de esta sesión." });
    },
    onSave: (strategy) => {
      storeStrategy(strategy);
      inspectStrategy(strategy.id);
      setStrategyNotice({ parcelId: parcel.id, text: "Estrategia guardada en esta sesión." });
      window.location.hash = "#estrategias/biblioteca";
    },
    inspect: inspectStrategy,
    simulation, serviceNotice, onRunSimulation: runSimulation, onCheckService: checkService,
    onLoadDemo: () => patch(demoPreparation(draft)),
  };

  const report = { parcel, referenceParcel, draft, strategies, comparisonIds, parcelRotations, selected, scenario, periodLabel };
  const workspaceProps = {
    ...report, section, patch, engine, requestedIndicator: route.indicatorId,
    interpretationEvidence: storedInspection.result ? { ...storedInspection.result, strategyName: selected.name } : undefined, parcels: displayParcels, rotations, strategyBook, explorerOpen, onOpenExplorer: openExplorer, selectedId: selected.id, metricId,
    onMetric: setMetricId, onSelectParcel: selectMapParcel, onSelectStrategy: inspectStrategy, onInspectResult: inspectStrategy,
  };

  return (
    <>
      <WorkspaceHeader parcels={displayParcels} activeParcel={parcel} onSelectParcel={selectParcel}
        rotations={strategies} activeStrategy={selected} onSelectStrategy={inspectStrategy} localStrategyControls={localStrategyControls}
        scenario={scenario} periodLabel={periodLabel} engineStatus={simulation.response ? simulation.status : undefined} />
      <div className={`shell workspace-shell${explorerOpen ? " economy-editing" : ""}${showParcelContext ? " with-parcel-context" : ""}${inspectorOpen && !explorerOpen ? " with-inspector" : ""}`}>
        <Navigation activeWorkspace={workspace.id} />
        {showParcelContext && <ParcelSidebar parcel={parcel} facts={parcelFacts} onReview={() => setReviewOpen(true)} />}
        <main className="main" id="workspace-content" tabIndex={-1}>
          <header className="hero">
            <div className="eyebrow">AgroDSS / San Luis</div>
            <h1>{workspace.label}</h1>
            {!explorerOpen && <button type="button" className="work-button inspector-toggle" aria-expanded={inspectorOpen}
              aria-controls={inspectorOpen ? "parcel-inspector" : undefined} onClick={() => setInspectorOpen(!inspectorOpen)}>
              {inspectorOpen ? "Ocultar inspector" : "Abrir inspector"}
            </button>}
          </header>
          {group && <nav className="workspace-subnav strategy-nav-groups" aria-label="Flujo de estrategias">
            {strategyGroups.map(([label, ids]) => <a key={label} href={"#estrategias/" + (ids.includes(section) ? section : ids[0])}
              aria-current={label === group[0] ? "true" : undefined}>{label}</a>)}
          </nav>}
          <nav className="workspace-subnav" aria-label={"Secciones de " + (group?.[0] ?? workspace.label)}>
            {workspace.sections.filter(([id]) => !group || group[1].includes(id)).map(([id, label]) => <a key={id}
              href={"#" + workspace.id + "/" + id} aria-current={id === section ? "page" : undefined}>{label}</a>)}
          </nav>
          {inspectorOpen && !explorerOpen && <a className="work-button strategy-inspector-jump" href="#parcel-inspector" onClick={(event) => {
            event.preventDefault();
            document.getElementById("parcel-inspector")?.focus();
          }}>Ir al inspector</a>}
          <Workspace {...workspaceProps} />
          <footer className="footer-note">{simulation.response ? "Resultados calculados por el motor AgroDSS (FAO-56 y FAO-33) con datos de NASA POWER: escenarios históricos descriptivos, no pronósticos."
            : "Las cifras de referencia son ficticias hasta ejecutar la simulación."} Los datos declarados se conservan durante la sesión abierta.</footer>
        </main>
        {explorerOpen
          ? <EconomicExplorer parcel={parcel} scenario={scenario} selected={selected} strategies={strategies} draft={draft}
            baseline={economicBaselines[activeParcelId]} patch={patch} onClose={closeExplorer} engine={engine} />

          : inspectorOpen && <Inspector parcel={parcel} parcelFacts={parcelFacts}
              strategy={selected} inspection={inspection} simulation={simulation} strategies={strategies} onStage={(stageId) => inspectStrategy(selected.id, { stageId })} parcelMode={workspace.id === "parcela" || parcelInspection}
              fullParcel={workspace.id === "parcela"} outsideComparison={!comparisonIds.includes(selected.id)}
              onReview={() => setReviewOpen(true)} onClose={() => {
                setInspectorOpen(false);
                document.querySelector(".inspector-toggle")?.focus();
              }} />}

      </div>
      <div className="print-only workspace-print"><ReportContent {...report} /></div>
      <AssumptionsDialog parcel={referenceParcel} simulation={simulation} isOpen={isReviewOpen} onClose={() => setReviewOpen(false)} />
    </>
  );
}

