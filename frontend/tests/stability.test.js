import { describe, expect, it, vi } from "vitest";
import { createSimulationRunner, postSimulation, waitForService } from "../src/services/api.js";
import { clearStoredDrafts, loadStoredDrafts, saveStoredDrafts } from "../src/workspaces/draftStorage.js";
import { emptyDraft, updateParcelDraft } from "../src/workspaces/session.js";

const reply = (status, body, id) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
  headers: { get: () => id ?? null },
});

describe("connecting to the calculation service", () => {
  it("retries a network failure and an interstitial response before recovering", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(reply(200, null)).mockResolvedValueOnce(reply(200, { status: "ok" }));
    const onRetry = vi.fn();
    await expect(waitForService({ fetchImpl, onRetry, delays: [0, 0, 0] })).resolves.toEqual({ status: "ok" });
    expect(onRetry.mock.calls.map(([error]) => error.code)).toEqual(["network_error", "service_unavailable"]);
    expect(fetchImpl.mock.calls.every(([url, options]) => url.endsWith("/health") && options.method === "GET")).toBe(true);
  });

  it("stops after a bounded number of attempts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(503, null));
    await expect(waitForService({ fetchImpl, delays: [0, 0] })).rejects.toMatchObject({ category: "hosting", status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unexpected 404 from a misconfigured API URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(404, null));
    await expect(waitForService({ baseUrl: "https://api.example.test/api/v1", fetchImpl, delays: [0, 0] }))
      .rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.example.test/api/v1/health");
  });
});

describe("simulation requests", () => {
  it.each([[503, "power_rate_limited"], [504, "power_timeout"]])("preserves NASA POWER errors (%i)", async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(status, {
      error: { category: "nasa_power", code, message: "No se pudo consultar NASA POWER.", request_id: "request-1" },
    }));
    await expect(postSimulation({}, { fetchImpl })).rejects.toMatchObject({ status, code, requestId: "request-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a slow POST and does not repeat it", async () => {
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    await expect(postSimulation({}, { fetchImpl, timeoutMs: 5 })).rejects.toMatchObject({ code: "client_timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never sends a POST when health fails and permits a new action after recovery", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce({ status: "ok" });
    const submit = vi.fn().mockResolvedValue({ results: [] });
    const run = createSimulationRunner({ check, submit });
    const update = vi.fn();
    await run("P-01", {}, update);
    expect(submit).not.toHaveBeenCalled();
    expect(update.mock.lastCall[0].error.message).toContain("todavía no se envió");
    await run("P-01", {}, update);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate clicks and keeps the draft after an ambiguous POST failure", async () => {
    const submit = vi.fn().mockRejectedValue(Object.assign(new Error("Fallo de red"), { code: "network_error" }));
    let drafts = { "P-01": { ...emptyDraft, identity: { latitude: "-33" } } };
    const update = (state) => { drafts = updateParcelDraft(drafts, "P-01", () => ({ simulationRun: state })); };
    const post = () => postSimulation({}, { fetchImpl: submit });
    const runner = createSimulationRunner({ check: async () => ({}), submit: post });
    await Promise.all([runner("P-01", {}, update), runner("P-01", {}, update)]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(drafts["P-01"].identity.latitude).toBe("-33");
    expect(drafts["P-01"].simulationRun.error.message).toContain("No se pudo confirmar");
  });
});

describe("browser-only parcel inputs", () => {
  const ids = ["P-01", "P-02"];
  function memoryStorage() {
    const data = new Map();
    return () => ({ getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key) });
  }

  it("restores allowlisted inputs per parcel and omits attachments, notes and runs", () => {
    const storage = memoryStorage();
    const drafts = {
      "P-01": { identity: { latitude: "10", name: "private" }, historyFiles: [{}], notes: "private", simulationRun: { status: "running" } },
      "P-02": { identity: { longitude: "-65" }, historical: { start_years: [2008] } },
      unknown: { identity: { latitude: "22" } },
    };
    expect(saveStoredDrafts(storage, drafts, ids)).toBe(true);
    const restored = loadStoredDrafts(storage, ids, emptyDraft);
    expect(restored["P-01"]).toMatchObject({ identity: { latitude: "10" }, historyFiles: [], notes: "" });
    expect(restored["P-01"].identity).not.toHaveProperty("name");
    expect(restored["P-01"]).not.toHaveProperty("simulationRun");
    expect(restored["P-02"]).toMatchObject(drafts["P-02"]);
    expect(restored).not.toHaveProperty("unknown");
    expect(clearStoredDrafts(storage)).toBe(true);
    expect(loadStoredDrafts(storage, ids, emptyDraft)).toBeNull();
  });

  it("ignores corrupt or incompatible storage and tolerates disabled storage", () => {
    const broken = () => ({ getItem: () => "{" });
    const old = () => ({ getItem: () => '{"version":0,"drafts":{}}' });
    const denied = () => { throw new Error("denied"); };
    for (const storage of [broken, old, denied]) expect(loadStoredDrafts(storage, ids, emptyDraft)).toBeNull();
    expect(saveStoredDrafts(denied, {}, ids)).toBe(false);
  });
});
