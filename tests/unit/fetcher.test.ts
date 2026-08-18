import { describe, expect, it, spyOn } from "bun:test";
import { NoResponseError, fetchWithTtftGuard } from "../../src/network/fetcher";

describe("Fetcher — Transport Error Wrapping", () => {
  it("wraps raw fetch network transport exceptions in NoResponseError when signal is not aborted", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
      return Promise.reject(new TypeError("Failed to fetch: Connection refused"));
    }) as unknown as typeof fetch);

    const options = {
      url: "http://127.0.0.1:59999/unreachable-test-endpoint",
      method: "POST" as const,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ test: true }),
      provider: "test-provider",
      keyIndex: 0,
    };

    let thrownError: unknown;
    try {
      await fetchWithTtftGuard(options);
    } catch (err: unknown) {
      thrownError = err;
    } finally {
      fetchSpy.mockRestore();
    }

    expect(thrownError).toBeInstanceOf(NoResponseError);
    expect((thrownError as Error).message).toBe("Network transport failure: Failed to fetch: Connection refused");
  });

  it("rethrows raw error when clientSignal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Client cancelled request"));

    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      return Promise.reject(abortErr);
    }) as unknown as typeof fetch);

    const options = {
      url: "http://127.0.0.1:59999/unreachable-test-endpoint",
      method: "POST" as const,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ test: true }),
      clientSignal: controller.signal,
      provider: "test-provider",
      keyIndex: 0,
    };

    let thrownError: unknown;
    try {
      await fetchWithTtftGuard(options);
    } catch (err: unknown) {
      thrownError = err;
    } finally {
      fetchSpy.mockRestore();
    }

    expect(thrownError).not.toBeInstanceOf(NoResponseError);
    expect((thrownError as Error).message).toBe("The operation was aborted");
  });
});
