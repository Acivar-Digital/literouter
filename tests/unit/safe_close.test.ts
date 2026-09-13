import { describe, expect, it, spyOn } from "bun:test";
import { safeClose } from "../../src/network/fetcher";

describe("safeClose", () => {
  it("successfully closes an active controller and marks isClosedRef.isClosed = true", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });

    const isClosedRef = { isClosed: false };
    const reader = stream.getReader();

    expect(isClosedRef.isClosed).toBe(false);
    expect(() => safeClose(controller, isClosedRef)).not.toThrow();
    expect(isClosedRef.isClosed).toBe(true);

    const result = await reader.read();
    expect(result.done).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it("is idempotent and does NOT throw or log when called again on an already-closed controller", () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });

    const isClosedRef = { isClosed: false };
    safeClose(controller, isClosedRef);
    expect(isClosedRef.isClosed).toBe(true);

    const debugSpy = spyOn(console, "debug");
    try {
      expect(() => safeClose(controller, isClosedRef)).not.toThrow();
      expect(debugSpy).not.toHaveBeenCalled();
      expect(isClosedRef.isClosed).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("does NOT throw or crash after the stream has been canceled (desiredSize === 0)", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });

    const reader = stream.getReader();
    await reader.cancel("client abort");

    // Under WHATWG Streams standard and Bun, desiredSize is 0 when canceled
    expect(controller.desiredSize).toBe(0);

    const isClosedRef = { isClosed: false };
    expect(() => safeClose(controller, isClosedRef)).not.toThrow();
    expect(isClosedRef.isClosed).toBe(true);
  });

  it("does not throw when called without isClosedRef on an already-closed controller", () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });

    controller.close();

    // Calling safeClose without isClosedRef on an already closed controller
    // catches any controller.close() error and safely suppresses it
    expect(() => safeClose(controller)).not.toThrow();
  });
});
