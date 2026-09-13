import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { safeClose } from "../../src/network/fetcher";

describe("Fetcher — safeClose controller teardown", () => {
  let originalEnvDebug: string | undefined;
  let originalLiterouterLogLevel: string | undefined;
  let originalLogLevel: string | undefined;

  beforeEach(() => {
    originalEnvDebug = process.env.DEBUG;
    originalLiterouterLogLevel = process.env.LITEROUTER_LOG_LEVEL;
    originalLogLevel = process.env.LOG_LEVEL;
    delete process.env.DEBUG;
    delete process.env.LITEROUTER_LOG_LEVEL;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (originalEnvDebug !== undefined) {
      process.env.DEBUG = originalEnvDebug;
    } else {
      delete process.env.DEBUG;
    }

    if (originalLiterouterLogLevel !== undefined) {
      process.env.LITEROUTER_LOG_LEVEL = originalLiterouterLogLevel;
    } else {
      delete process.env.LITEROUTER_LOG_LEVEL;
    }

    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
  });

  it("sets isClosedRef.isClosed to true and closes controller", () => {
    let closedCount = 0;
    const mockController = {
      desiredSize: 1,
      close: () => {
        closedCount++;
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const isClosedRef = { isClosed: false };
    expect(isClosedRef.isClosed).toBe(false);

    safeClose(mockController, isClosedRef);

    expect(isClosedRef.isClosed).toBe(true);
    expect(closedCount).toBe(1);
  });

  it("is idempotent and does not call controller.close multiple times", () => {
    let closedCount = 0;
    const mockController = {
      desiredSize: 1,
      close: () => {
        closedCount++;
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const isClosedRef = { isClosed: false };

    safeClose(mockController, isClosedRef);
    safeClose(mockController, isClosedRef);
    safeClose(mockController, isClosedRef);

    expect(isClosedRef.isClosed).toBe(true);
    expect(closedCount).toBe(1);
  });

  it("does not throw on already-closed or canceled real ReadableStream", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        streamController = c;
      },
    });

    const reader = stream.getReader();
    await reader.cancel("client abort");

    const isClosedRef = { isClosed: false };
    expect(() => {
      safeClose(streamController, isClosedRef);
    }).not.toThrow();

    expect(isClosedRef.isClosed).toBe(true);
  });

  it("does not throw when controller.close() throws an exception", () => {
    const throwingController = {
      desiredSize: 1,
      close: () => {
        throw new TypeError("Cannot close an already closed or errored stream");
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const isClosedRef = { isClosed: false };

    expect(() => {
      safeClose(throwingController, isClosedRef);
    }).not.toThrow();

    expect(isClosedRef.isClosed).toBe(true);
  });

  it("suppresses debug logs when debug logging is not enabled", () => {
    const debugSpy = spyOn(console, "debug");

    const throwingController = {
      desiredSize: 1,
      close: () => {
        throw new Error("stream canceled");
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    safeClose(throwingController);

    expect(debugSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it("logs debug message when DEBUG is enabled", () => {
    process.env.DEBUG = "1";
    const debugSpy = spyOn(console, "debug");

    const throwingController = {
      desiredSize: 1,
      close: () => {
        throw new Error("stream canceled by client");
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    safeClose(throwingController);

    expect(debugSpy).toHaveBeenCalled();
    const loggedMsg = debugSpy.mock.calls[0]?.[0];
    expect(loggedMsg).toContain("[Stream] Suppressed controller close error: stream canceled by client");
    debugSpy.mockRestore();
  });

  it("logs debug message when LITEROUTER_LOG_LEVEL=debug is enabled", () => {
    process.env.LITEROUTER_LOG_LEVEL = "debug";
    const debugSpy = spyOn(console, "debug");

    const throwingController = {
      desiredSize: 1,
      close: () => {
        throw new Error("stream abort by client");
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    safeClose(throwingController);

    expect(debugSpy).toHaveBeenCalled();
    const loggedMsg = debugSpy.mock.calls[0]?.[0];
    expect(loggedMsg).toContain("[Stream] Suppressed controller close error: stream abort by client");
    debugSpy.mockRestore();
  });

  it("handles call when isClosedRef is undefined", () => {
    let closedCount = 0;
    const mockController = {
      desiredSize: 1,
      close: () => {
        closedCount++;
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    expect(() => {
      safeClose(mockController);
    }).not.toThrow();
    expect(closedCount).toBe(1);
  });
});
