import { describe, test, expect } from "bun:test";
import { FIXTURES, svgToDataUri } from "./fixtures";
import { auditA11y } from "./stage5_a11y";

describe("Web Stages Fixtures & A11y Audit", () => {
  test("fixtures provide valid SVG and data URIs", () => {
    expect(FIXTURES.saasDashboard).toBeDefined();
    expect(FIXTURES.pricingTable).toBeDefined();
    expect(FIXTURES.authModalError).toBeDefined();

    expect(FIXTURES.saasDashboard.dataUri).toStartWith("data:image/svg+xml;base64,");
    expect(FIXTURES.pricingTable.dataUri).toStartWith("data:image/svg+xml;base64,");
    expect(FIXTURES.authModalError.dataUri).toStartWith("data:image/svg+xml;base64,");

    const decoded = Buffer.from(FIXTURES.authModalError.dataUri.split(",")[1] ?? "", "base64").toString("utf-8");
    expect(decoded).toContain("<svg");
  });

  test("auditA11y detects <div onClick> violations", () => {
    const badCode = `
      export function Modal() {
        return (
          <div onClick={() => alert('clicked')}>Click me</div>
        );
      }
    `;
    const result = auditA11y(badCode);
    expect(result.passed).toBe(false);
    expect(result.metrics.interactiveDivsCount).toBe(1);
    expect(result.violations.some((v) => v.rule === "no-interactive-element-to-div")).toBe(true);
  });

  test("auditA11y detects missing img alt attribute", () => {
    const badCode = `
      export function Avatar() {
        return <img src="/user.png" className="w-8 h-8 rounded-full" />;
      }
    `;
    const result = auditA11y(badCode);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.rule === "image-alt-missing")).toBe(true);
  });

  test("auditA11y approves semantic buttons, labeled inputs and dialog roles", () => {
    const accessibleCode = `
      export function AuthDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
        if (!isOpen) return null;
        return (
          <div role="dialog" aria-modal="true" aria-labelledby="modal-title" className="fixed inset-0">
            <h2 id="modal-title">Sign In</h2>
            <form>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required />

              <label htmlFor="pwd">Password</label>
              <input id="pwd" type="password" required />

              <img src="/logo.png" alt="Company Logo" />
              <button type="submit">Submit</button>
              <button type="button" onClick={onClose}>Cancel</button>
            </form>
          </div>
        );
      }
    `;
    const result = auditA11y(accessibleCode);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.violations.length).toBe(0);
    expect(result.metrics.nativeButtonsCount).toBe(2);
    expect(result.metrics.interactiveDivsCount).toBe(0);
    expect(result.metrics.labeledInputs).toBe(2);
    expect(result.metrics.modalAriaCompliant).toBe(true);
  });
});
