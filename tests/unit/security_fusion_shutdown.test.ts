import { describe, expect, it, mock, spyOn } from "bun:test";
import { executeDispatchPipeline, type DispatchRequest } from "../../src/engine/dispatch";
import { parseDirective } from "../../src/directive/parser";
import { trackInFlight, drainInFlight, getInFlightCount, resetDrainState } from "../../src/lifecycle/shutdown";
import * as openaiCompat from "../../src/handlers/openai_compat";

describe("Step 5: Fusion Directives in v4.1 Dispatch & Wire Graceful Shutdown", () => {
  describe("Fusion Directive in executeDispatchPipeline", () => {
    it("routes fusion directives directly to executeFusionFlow instead of falling back to 'or'", async () => {
      const directive = parseDirective("lr-fse-fast");
      expect(directive).not.toBeNull();
      expect(directive?.type).toBe("fusion");

      const fusionSpy = spyOn(openaiCompat, "executeFusionFlow").mockImplementation(async () => {
        return new Response(JSON.stringify({ id: "fusion_ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      try {
        const dummyReq: DispatchRequest = {
          reqId: "req-fusion-test",
          method: "POST",
          path: "/v1/chat/completions",
          directive: directive!,
          rawInboundBody: { model: "claude-3-7-sonnet" },
          outboundPayload: {
            endpointKey: "ch",
            method: "POST",
            headers: {},
            body: { model: "claude-3-7-sonnet" },
            isStreaming: false,
          },
          clientSignal: new AbortController().signal,
          clientHeaders: new Headers({ "user-agent": "test-agent" }),
          transformer: {
            transformClientToWire: () => ({ endpointKey: "ch", method: "POST", headers: {}, body: {}, isStreaming: false }),
            transformWireToClient: (data) => data,
            createWireToClientStream: () => new TransformStream(),
          },
        };

        const res = await executeDispatchPipeline(dummyReq);
        expect(fusionSpy).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(200);
      } finally {
        fusionSpy.mockRestore();
      }
    });
  });

  describe("Wire Graceful Shutdown (trackInFlight and drainInFlight)", () => {
    it("tracks in-flight requests and drains gracefully", async () => {
      resetDrainState();
      expect(getInFlightCount()).toBe(0);

      let resolveSlowReq: () => void = () => {};
      const slowReq = new Promise<void>((resolve) => {
        resolveSlowReq = resolve;
      });

      trackInFlight(slowReq);
      expect(getInFlightCount()).toBe(1);

      let drained = false;
      const drainPromise = drainInFlight(1000).then(() => {
        drained = true;
      });

      expect(drained).toBe(false);

      // Finish request
      resolveSlowReq();
      await slowReq;
      await drainPromise;

      expect(drained).toBe(true);
      expect(getInFlightCount()).toBe(0);
      resetDrainState();
    });
  });
});
