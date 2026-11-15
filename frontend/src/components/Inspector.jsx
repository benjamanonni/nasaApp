
import { ContextualInspector } from "../workspaces/strategies/StrategyComparison.jsx";

export default function Inspector({ parcel, parcelFacts, strategy, inspection, simulation, strategies, onStage, parcelMode, fullParcel, outsideComparison, onReview, onClose }) {
  if (!parcelMode) return <ContextualInspector parcel={parcel} strategy={strategy}
    inspection={inspection} simulation={simulation} strategies={strategies} onStage={onStage} outsideComparison={outsideComparison} onClose={onClose} />;

  return <aside className="inspector" id="parcel-inspector" tabIndex={-1} aria-label="Inspector de parcela">
    <div className="sticky">
      <div className="inspector-top">
        <span className="eyebrow">Inspector de parcela</span>
        <button type="button" className="work-button" onClick={onClose}>Cerrar</button>
      </div>
      <h2>{parcel.name}</h2>
      {fullParcel ? <>
        <dl className="work-readout">{parcelFacts.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}</dl>
        <button type="button" className="review-btn" onClick={onReview}>{simulation?.response ? "Consultar supuestos y procedencia del motor" : "Consultar referencia de ejemplo"}</button>
      </> : <a className="work-button" href="#parcela/identificacion">Ver ficha en Mi parcela</a>}
    </div>
  </aside>;
}
