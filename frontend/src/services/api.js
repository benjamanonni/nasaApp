// Client of the AgroDSS backend (contract 1.0). The UI only sends inputs and shows results:
// every agronomic calculation lives in the FastAPI service.

const DEFAULT_BASE_URL = "/api/v1";

export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

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

const unavailableStatuses = [502, 503, 504, 521, 522, 523, 524];
const httpMessages = {
  422: "Revisá los datos ingresados antes de volver a simular.",
  500: "El servicio de cálculo tuvo un error interno.",
  502: "El servidor intermedio recibió una respuesta inválida del servicio de cálculo.",
  503: "El servicio de cálculo está temporalmente fuera de línea o iniciándose.",
  504: "El servidor intermedio esperó demasiado al servicio de cálculo.",
};

export async function apiRequest(path, {
  method = "GET", body, baseUrl = API_BASE_URL, fetchImpl = globalThis.fetch,
  timeoutMs = method === "GET" ? 15000 : 90000,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetchImpl(baseUrl + path, {
      method, signal: controller.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    payload = await readJson(response);
    if (controller.signal.aborted) throw new Error("Request timed out");
  } catch {
    const timeout = controller.signal.aborted;
    const offline = globalThis.navigator?.onLine === false;
    throw new ApiError({
      code: timeout ? "client_timeout" : offline ? "offline" : "network_error",
      requestId: response?.headers?.get?.("X-Request-ID") ?? null,
      message: timeout ? "Se agotó el tiempo de espera del navegador."
        : offline ? "El dispositivo parece estar sin conexión. Revisá tus datos móviles o Wi-Fi."
          : "No se pudo conectar con el servicio de cálculo. Puede estar iniciándose o puede haber un problema de red o de permisos de acceso (CORS).",
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.ok && payload && typeof payload === "object" && !Array.isArray(payload)
      && (path !== "/health" || payload.status === "ok")) return payload;
  const envelope = payload?.error;
  const unavailable = unavailableStatuses.includes(response.status) || response.ok;
  throw new ApiError({
    status: response.status,
    category: envelope?.category ?? (unavailable ? "hosting" : response.status >= 500 ? "internal" : "input"),
    code: envelope?.code ?? (unavailable ? "service_unavailable" : "unexpected_response"),
    message: envelope?.message ?? httpMessages[response.status] ?? (unavailable
      ? "El servicio de cálculo todavía no entregó una respuesta válida. Puede estar iniciándose."
      : `El servicio de cálculo respondió con un formato inesperado (HTTP ${response.status}).`),
    retryable: envelope?.retryable ?? unavailable,
    requestId: envelope?.request_id ?? response.headers?.get?.("X-Request-ID") ?? null,
    details: Array.isArray(envelope?.details) ? envelope.details.map(({ field, message, code }) => ({ field, message, code: code ?? null })) : [],
  });
}

export const getHealth = (options) => apiRequest("/health", options);
export const getCatalog = (options) => apiRequest("/catalog", options);
export const postSimulation = (request, options) => apiRequest("/simulations", { ...options, method: "POST", body: request });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForService({ onRetry, delays = [0, 1500, 2500, 5000], ...options } = {}) {
  for (const [index, delay] of delays.entries()) {
    if (delay) await pause(delay);
    try {
      return await getHealth(options);
    } catch (error) {
      if (!error.retryable || index === delays.length - 1) throw error;
      onRetry?.(error);
    }
  }
}

export function createSimulationRunner({ check = waitForService, submit = postSimulation } = {}) {
  const pending = new Set();
  return async (parcelId, request, onUpdate) => {
    if (pending.has(parcelId)) return;
    pending.add(parcelId);
    let submitted = false;
    try {
      onUpdate({ status: "running", phase: "connecting" });
      await check({ onRetry: () => onUpdate({ status: "running", phase: "waking" }) });
      onUpdate({ status: "running", phase: "calculating" });
      submitted = true;
      const response = await submit(request);
      onUpdate({ status: "done", response, executedAt: new Date().toISOString() });
    } catch (caught) {
      const error = errorSummary(caught);
      if (!submitted) {
        error.message += " La simulación todavía no se envió.";
      } else if (error.category === "network" || error.category === "hosting") {
        error.message += " No se pudo confirmar si la simulación anterior terminó. Revisá la conexión antes de volver a enviarla.";
        error.retryable = false;
      }
      onUpdate({ status: "error", error });
    } finally {
      pending.delete(parcelId);
    }
  };
}
