// Client of the AgroDSS backend (contract 1.0). The UI only sends inputs and shows results:
// every agronomic calculation lives in the FastAPI service.

const DEFAULT_BASE_URL = "/api/v1";

export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

/** Error of the service, already normalised to the single error envelope of the contract. */
export class ApiError extends Error {
  constructor({ status = 0, category = "network", code = "network_error", message, retryable = true, requestId = null, details = [] }) {
    super(message);
    this.name = "ApiError";
    Object.assign(this, { status, category, code, retryable, requestId, details });
  }
}

/** Plain object that can be stored in the session state and exported as JSON. */
export function errorSummary(error) {
  if (error instanceof ApiError) {
    const { status, category, code, message, retryable, requestId, details } = error;
    return { status, category, code, message, retryable, requestId, details };
  }
  return { status: 0, category: "internal", code: "unexpected_client_error", retryable: false, requestId: null, details: [],
    message: "Ocurrió un error inesperado en la aplicación al consultar el servicio de cálculo." };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiRequest(path, { method = "GET", body, baseUrl = API_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(baseUrl + path, {
      method,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError({ message: `No se pudo conectar con el servicio de cálculo (${baseUrl}). Verificá que el backend esté en ejecución.` });
  }
  const payload = await readJson(response);
  if (response.ok && payload !== null) return payload;
  const envelope = payload?.error;
  throw new ApiError({
    status: response.status,
    category: envelope?.category ?? (response.status >= 500 ? "internal" : "input"),
    code: envelope?.code ?? "unexpected_response",
    message: envelope?.message ?? `El servicio de cálculo respondió con un formato inesperado (HTTP ${response.status}).`,
    retryable: envelope?.retryable ?? response.status >= 502,
    requestId: envelope?.request_id ?? response.headers?.get?.("X-Request-ID") ?? null,
    details: Array.isArray(envelope?.details) ? envelope.details.map(({ field, message, code }) => ({ field, message, code: code ?? null })) : [],
  });
}

export const getHealth = (options) => apiRequest("/health", options);
export const getCatalog = (options) => apiRequest("/catalog", options);
export const postSimulation = (request, options) => apiRequest("/simulations", { ...options, method: "POST", body: request });
