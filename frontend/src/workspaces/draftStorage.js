const storageKey = "agrodss.parcel-inputs";
const version = 1;
const maxLength = 200000;
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const textFields = (value, fields) => Object.fromEntries(
  fields.filter((key) => typeof value?.[key] === "string" && value[key].length <= 300)
    .map((key) => [key, value[key]]),
);

function savedInputs(draft) {
  const soil = Object.fromEntries(
    ["fieldCapacity", "wiltingPoint", "depth", "availableWater", "fallowKc", "texture", "moisture"]
      .filter((key) => record(draft.soil?.[key]))
      .map((key) => [key, textFields(draft.soil[key], ["value", "unit", "source", "basis"])]),
  );
  const historical = textFields(draft.historical, ["start_day", "start_month"]);
  if (Array.isArray(draft.historical?.start_years)) {
    historical.start_years = draft.historical.start_years.slice(0, 10)
      .filter((year) => Number.isInteger(year) || (typeof year === "string" && /^\d{4}$/.test(year)));
  }
  return { identity: textFields(draft.identity, ["latitude", "longitude", "area"]), soil, historical };
}

function parcelInputs(drafts, parcelIds) {
  return Object.fromEntries(parcelIds.filter((id) => record(drafts[id])).map((id) => [id, savedInputs(drafts[id])]));
}

export function loadStoredDrafts(storage, parcelIds, emptyDraft) {
  try {
    const raw = storage()?.getItem(storageKey);
    if (!raw || raw.length > maxLength) return null;
    const data = JSON.parse(raw);
    if (data?.version !== version || !record(data.drafts)) return null;
    return Object.fromEntries(Object.entries(parcelInputs(data.drafts, parcelIds))
      .map(([id, inputs]) => [id, { ...emptyDraft, ...inputs }]));
  } catch {
    return null;
  }
}

export function saveStoredDrafts(storage, drafts, parcelIds) {
  try {
    const local = storage();
    if (!local) return false;
    const raw = JSON.stringify({ version, drafts: parcelInputs(drafts, parcelIds) });
    if (raw.length > maxLength) return false;
    local.setItem(storageKey, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredDrafts(storage) {
  try {
    storage()?.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
