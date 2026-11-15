import aerialImage from "../assets/parcel-aerial-v2.jpg";
import { mapWidth, mapHeight } from "../data/parcels.js";

function getPreviewViewBox(points) {
  const coordinates = points.split(" ").map((point) => point.split(",").map(Number));
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  const ratio = 1.42;
  const width = Math.min(mapWidth, mapHeight * ratio, Math.max(right - left, (bottom - top) * ratio) * 1.18);
  const height = width / ratio;
  const x = Math.max(0, Math.min(mapWidth - width, (left + right - width) / 2));
  const y = Math.max(0, Math.min(mapHeight - height, (top + bottom - height) / 2));
  return [x, y, width, height].map(Math.round).join(" ");
}

export default function ParcelSidebar({ parcel, facts, onReview }) {
  return (
    <aside className="sidebar" id="parcel-context" aria-label="Contexto de la parcela">
      <div className="side-section">
        <div className="side-heading"><h3>Parcela de análisis</h3></div>
        <div className="parcel">
          <div className="parcel-art" role="img" aria-label={`Contorno ilustrativo de ${parcel.name}, ${parcel.id}`}>
            <svg viewBox={getPreviewViewBox(parcel.points)} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
              <image href={aerialImage} width={mapWidth} height={mapHeight} preserveAspectRatio="none" />
              <polygon points={parcel.points} fill="#acdb77" fillOpacity=".14" stroke="#e1e8d6" strokeWidth="2"
                vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="parcel-info">
            <strong>Ubicación declarada</strong>
            <p>{[parcel.declared.locality, parcel.declared.province].filter(Boolean).join(" · ") || "Sin informar"}</p>
          </div>
        </div>
      </div>
      <div className="side-section">
        <div className="data-table">
          {facts.map(([label, value]) => (
            <div className="data-line" key={label}>
              <span>{label}</span><strong>{value}</strong>
            </div>
          ))}
        </div>
        <button type="button" className="review-btn" onClick={onReview}>
          Consultar referencia de ejemplo <span aria-hidden="true">↗</span>
        </button>
      </div>
    </aside>
  );
}
