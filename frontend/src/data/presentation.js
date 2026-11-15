const numberFormat = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const moneyFormat = new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", maximumFractionDigits: 0,
});

export const formatNumber = (value) => numberFormat.format(value);
export const formatMoney = (value) => moneyFormat.format(value);

export const metrics = [
  {
    id: "economy", label: "Economía", valueKey: "margin", widthKey: "marginWidth",
    description: "Margen bruto ficticio de cada rotación durante dos años. Ingresos ilustrativos menos costos directos ilustrativos, por hectárea.",
    title: "Margen bruto por alternativa — 2 años",
    axis: "margen bruto (ARS/ha, acumulado en 2 años)",
    ticks: ["0", "200 mil", "400 mil", "600 mil", "800 mil"],
    format: (value) => `${value / 1000} mil`,
  },
  {
    id: "water", label: "Agua", valueKey: "deficit", widthKey: "deficitWidth",
    description: "Déficit hídrico ficticio por estrategia. Los valores son de ejemplo.",
    title: "Déficit hídrico por alternativa — ejemplo",
    axis: "déficit hídrico ilustrativo (mm)",
    ticks: ["0 mm", "40 mm", "80 mm", "120 mm", "160 mm"],
    format: (value) => `${formatNumber(value)} mm`,
  },
  {
    id: "soil", label: "Suelo", valueKey: "cover", widthKey: "coverWidth",
    description: "Meses ilustrativos con cultivo vivo dentro de un horizonte de 24 meses. No equivalen a meses de suelo desnudo.",
    title: "Períodos con cultivo vivo — ejemplo",
    axis: "meses con cultivo vivo (de 24 meses)",
    ticks: ["0 m", "6 m", "12 m", "18 m", "24 m"],
    format: (value) => `${value} m`,
  },
  {
    id: "production", label: "Producción",
    description: "Rendimientos ficticios de la maqueta original, sin datos por parcela. El centeno es un cultivo de cobertura.",
    title: "Rendimientos por cultivo (t/ha) · muestra general",
  },
];
