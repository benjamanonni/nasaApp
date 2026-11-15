export const comparisonPeriod = "Dos campañas";

export function selectedStrategies(strategies, ids) {
  return ids.map((id) => strategies.find((strategy) => strategy.id === id)).filter(Boolean);
}

export function comparisonRows(strategies, demoResults) {
  return strategies.map((strategy) => {
    const demonstration = strategy.isTemplate ? demoResults.find(({ id }) => id === strategy.id) ?? null : null;
    return { strategy, demonstration, status: demonstration ? "Referencia ficticia" : "Sin ejecutar" };
  });
}

export const yieldColumns = [["maize", "Maíz"], ["wheat", "Trigo"], ["soy-first", "Soja de primera"],
  ["soy", "Soja sin distinción"], ["soy-second", "Soja de segunda"]];

export function yieldValues(strategy, demonstration) {
  if (!demonstration) return [];
  const [maize, wheat, soy] = demonstration.yields;
  return [maize, wheat, ...yieldColumns.slice(2).map(([id]) => strategy.stages.some(({ cropId }) => cropId === id) ? soy : null)];
}
