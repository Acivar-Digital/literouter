/**
 * tests/unit/eval_stages_web_stage3_4.test.ts
 *
 * Unit tests for Stage 3 (State & Interactive Events) and Stage 4 (Code Hygiene & Anti-Hallucination).
 */

import { describe, expect, it } from "bun:test";
import {
  analyzeStateManagement,
  extractCodeSnippet,
  runStage3State,
} from "../../eval/stages_web/stage3_state";
import {
  analyzeCodeHygiene,
  detectDangerousPatterns,
  detectHallucinatedImports,
  detectPlaceholders,
  isAllowedImport,
  runStage4Hygiene,
} from "../../eval/stages_web/stage4_hygiene";
import type { StageContext } from "../../eval/stages_web/types";

describe("Stage 3: Interactive State & Event Architecture", () => {
  const goodComponentCode = `
import React, { useState } from 'react';

export default function FeedbackModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !description) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // simulate submission
      setSuccess(true);
    } catch (err) {
      setError('Failed to submit feedback');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg max-w-md w-full">
        <button onClick={onClose} className="float-right">Close</button>
        <h2>Feedback Form</h2>
        {error && <div className="text-red-500 mb-4">{error}</div>}
        {success && <div className="text-green-500 mb-4">Thank you!</div>}
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your Email"
            className="border p-2 w-full mb-3"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Feedback Description"
            className="border p-2 w-full mb-3"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            {loading ? <span>Submitting...</span> : 'Send Feedback'}
          </button>
        </form>
      </div>
    </div>
  );
}
`;

  const badComponentCode = `
import React from 'react';

export default function BrokenModal() {
  const handleSubmit = () => {};

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input placeholder="Uncontrolled" />
        <textarea placeholder="No value or onChange"></textarea>
        <button type="submit">Submit</button>
      </form>
    </div>
  );
}
`;

  it("extractCodeSnippet handles markdown code fences cleanly", () => {
    const markdown = "Here is the code:\n```tsx\nexport default function App() { return <div>Hello</div>; }\n```";
    const extracted = extractCodeSnippet(markdown);
    expect(extracted).toContain("export default function App");
    expect(extracted).not.toContain("```");
  });

  it("analyzeStateManagement accurately scores full interactive state architecture", () => {
    const analysis = analyzeStateManagement(goodComponentCode);
    expect(analysis.score).toBeGreaterThanOrEqual(80);
    expect(analysis.passed).toBe(true);
    expect(analysis.subChecks.stateHooks.passed).toBe(true);
    expect(analysis.subChecks.controlledInputs.passed).toBe(true);
    expect(analysis.subChecks.submissionHandler.passed).toBe(true);
    expect(analysis.subChecks.submissionHandler.hasPreventDefault).toBe(true);
    expect(analysis.subChecks.interactiveToggles.passed).toBe(true);
  });

  it("analyzeStateManagement detects no-op stubs and uncontrolled inputs", () => {
    const analysis = analyzeStateManagement(badComponentCode);
    expect(analysis.score).toBeLessThan(50);
    expect(analysis.passed).toBe(false);
    expect(analysis.subChecks.submissionHandler.isNoop).toBe(true);
    expect(analysis.subChecks.stateHooks.passed).toBe(false);
  });

  it("runStage3State handles unreachable gateway gracefully", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async () => {
      throw new Error("Connection refused (ECONNREFUSED)");
    };
    try {
      const ctx: StageContext = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://127.0.0.1:59999/v1/chat/completions",
        runs: 1,
      };
      const result = await runStage3State(ctx);
      expect(result.stageNumber).toBe(3);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.error).toBeDefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("runStage3State executes cleanly against mocked response", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = (async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `\`\`\`tsx\n${goodComponentCode}\n\`\`\``,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    try {
      const ctx: StageContext = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://127.0.0.1:59999/v1/chat/completions",
        runs: 1,
      };
      const result = await runStage3State(ctx);
      expect(result.stageNumber).toBe(3);
      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.checks.length).toBe(4);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("Stage 4: Code Hygiene & Anti-Hallucination Guardrails", () => {
  const cleanCode = `
import React from 'react';
import { Activity, ShieldCheck } from 'lucide-react';

export default function HealthCard() {
  const metrics = [
    { label: 'CPU Usage', value: '28%', barWidth: 'w-[28%]' },
    { label: 'Memory', value: '4.2GB / 16GB', barWidth: 'w-[45%]' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-white max-w-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          Server Health
        </h3>
        <span className="flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full">
          <ShieldCheck className="w-3.5 h-3.5" />
          Healthy
        </span>
      </div>
      <div className="space-y-3">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{m.label}</span>
              <span>{m.value}</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div className={\`bg-emerald-500 h-2 rounded-full \${m.barWidth}\`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
`;

  const dirtyCode = `
import React from 'react';
import { MagicSuperWidget } from 'hallucinated-fake-charts-lib';

export default function BadCard() {
  // TODO: implement real metrics fetching later
  // rest of code goes here

  return (
    <div>
      <!-- insert icon here -->
      <div>Chart goes here</div>
      <p>...</p>
      <div dangerouslySetInnerHTML={{ __html: "<img src=x onerror=alert(1)>" }} />
      <a href="javascript:doBadThings()">Click here</a>
    </div>
  );
}
`;

  it("isAllowedImport properly identifies whitelist and relative modules", () => {
    expect(isAllowedImport("react")).toBe(true);
    expect(isAllowedImport("lucide-react")).toBe(true);
    expect(isAllowedImport("@heroicons/react/24/outline")).toBe(true);
    expect(isAllowedImport("./components/Button")).toBe(true);
    expect(isAllowedImport("@/lib/utils")).toBe(true);
    expect(isAllowedImport("hallucinated-chart-lib")).toBe(false);
    expect(isAllowedImport("shadcn-fake-component-xyz")).toBe(false);
  });

  it("detectPlaceholders finds comment stubs, ellipsis, and 'goes here' text", () => {
    const violations = detectPlaceholders(dirtyCode);
    expect(violations.length).toBeGreaterThanOrEqual(3);
    expect(violations.some((v) => v.includes("TODO"))).toBe(true);
    expect(violations.some((v) => v.includes("Chart goes here"))).toBe(true);
  });

  it("detectHallucinatedImports flags unauthorized third-party libraries", () => {
    const { hallucinatedImports } = detectHallucinatedImports(dirtyCode);
    expect(hallucinatedImports).toContain("hallucinated-fake-charts-lib");
  });

  it("detectDangerousPatterns detects raw dangerouslySetInnerHTML and javascript URIs", () => {
    const dangerous = detectDangerousPatterns(dirtyCode);
    expect(dangerous.some((d) => d.includes("dangerouslySetInnerHTML"))).toBe(true);
    expect(dangerous.some((d) => d.includes("javascript:"))).toBe(true);
  });

  it("analyzeCodeHygiene awards full score to clean production component", () => {
    const analysis = analyzeCodeHygiene(cleanCode);
    expect(analysis.score).toBe(100);
    expect(analysis.passed).toBe(true);
    expect(analysis.subChecks.placeholders.passed).toBe(true);
    expect(analysis.subChecks.hallucinatedPackages.passed).toBe(true);
    expect(analysis.subChecks.dangerousPatterns.passed).toBe(true);
  });

  it("analyzeCodeHygiene heavily penalizes dirty code with hallucinations and stubs", () => {
    const analysis = analyzeCodeHygiene(dirtyCode);
    expect(analysis.score).toBeLessThan(40);
    expect(analysis.passed).toBe(false);
  });

  it("runStage4Hygiene handles unreachable gateway gracefully", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async () => {
      throw new Error("Connection refused (ECONNREFUSED)");
    };
    try {
      const ctx: StageContext = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://127.0.0.1:59999/v1/chat/completions",
        runs: 1,
      };
      const result = await runStage4Hygiene(ctx);
      expect(result.stageNumber).toBe(4);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.error).toBeDefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("runStage4Hygiene executes cleanly against mocked response", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = (async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `\`\`\`tsx\n${cleanCode}\n\`\`\``,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    try {
      const ctx: StageContext = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://127.0.0.1:59999/v1/chat/completions",
        runs: 1,
      };
      const result = await runStage4Hygiene(ctx);
      expect(result.stageNumber).toBe(4);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.checks.length).toBe(3);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
