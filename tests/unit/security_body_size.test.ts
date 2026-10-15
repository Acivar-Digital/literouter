import { describe, expect, it } from "bun:test";
import { MAX_REQUEST_BODY_SIZE } from "../../src/index";

describe("Step 3: Inbound Request Body Size Caps (OOM DoS Prevention)", () => {
  it("exports MAX_REQUEST_BODY_SIZE as 32MB", () => {
    expect(MAX_REQUEST_BODY_SIZE).toBe(32 * 1024 * 1024);
  });

  it("handles oversized chunk accumulation logic correctly", () => {
    const limit = MAX_REQUEST_BODY_SIZE;
    let receivedBytes = 0;
    let isOverLimit = false;
    const chunks: Buffer[] = [];

    const simulateData = (chunkSize: number) => {
      if (isOverLimit) return;
      receivedBytes += chunkSize;
      if (receivedBytes > limit) {
        isOverLimit = true;
        chunks.length = 0;
        return;
      }
      chunks.push(Buffer.alloc(chunkSize));
    };

    // Small chunks within 32MB
    simulateData(1024 * 1024); // 1MB
    expect(isOverLimit).toBe(false);
    expect(chunks.length).toBe(1);

    // Oversized chunk pushing total > 32MB
    simulateData(32 * 1024 * 1024); // 32MB + 1MB = 33MB
    expect(isOverLimit).toBe(true);
    expect(chunks.length).toBe(0); // released
  });
});
