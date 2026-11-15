export default function WorkspaceHeader({ parcels, activeParcel, onSelectParcel, rotations, activeStrategy, onSelectStrategy, localStrategyControls, periodLabel, engineStatus }) {
  return (
    <header className="workspace-top" id="overview">
      <a className="workspace-brand" href="#overview" aria-label="AgroDSS, inicio">
        <svg width="37" height="37" viewBox="0 0 39 39" aria-hidden="true">
          <path fill="#9fb698" d="M34 4c1 17-5 26-16 26-3 0-6-1-8-3C4 17 14 5 34 4Z" />
          <path stroke="#202b30" strokeWidth="1.7" fill="none" d="M5 34c7-9 13-15 23-23" />
          <path stroke="#9fb698" strokeWidth="1.7" d="m4 35 8-9" />
        </svg>
        <span><strong>Agro<span>DSS</span></strong><small>Apoyo a decisiones agrícolas</small></span>
      </a>
      <div className="workspace-controls">
        <label className="workspace-control">
          <span>Parcela activa</span>
          <select value={activeParcel.id} onChange={(event) => onSelectParcel(event.target.value)}>
            {parcels.map(({ id, name, displayId }) => <option value={id} key={id}>{name} · {displayId}</option>)}
          </select>
        </label>
        {localStrategyControls ? <div className="workspace-control">
          <span>Rotación activa</span><strong>{activeStrategy.name}</strong>
        </div> : <label className="workspace-control">
          <span>Rotación activa</span>
          <select value={activeStrategy.id} onChange={(event) => onSelectStrategy(event.target.value)}>
            {rotations.map(({ id, sequence, name, isTemplate }) => <option value={id} key={id}>{isTemplate === false ? name : `${id} · ${sequence}`}</option>)}
          </select>
        </label>}
        <div className="workspace-control period-control">
          <span>Horizonte de indicadores</span><strong>{periodLabel}</strong>
        </div>
      </div>
      <div className="top-actions">
        <span className="demo-tag">{engineStatus === "current" ? "MOTOR EJECUTADO · NASA POWER" : engineStatus ? "RESULTADOS POR RECALCULAR" : "DATOS FICTICIOS"}</span>
        <button className="print-button" onClick={() => window.print()} type="button">
          <svg aria-hidden="true" className="ico" viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4V9h16v9h-2M6 15h12v6H6z" /></svg>
          Imprimir vista
        </button>
      </div>
    </header>
  );
}

