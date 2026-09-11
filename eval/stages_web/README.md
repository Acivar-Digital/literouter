# 🌐 Web Vision-Language Evaluation Stages (`eval/stages_web/`)

> **5-Stage Frontend UI Engineering Benchmark: DOM Architecture, Tailwind Responsiveness, React State & Accessibility**

This folder contains the stage implementations for `eval/web.ts`. It audits a model's ability to translate visual mockups (or wireframe specs) into production-ready web frontend code without relying on heavy headless browsers.

---

## 🚀 Why Zero Browser Dependencies?
Traditional web evaluations require headless Chromium, Selenium, or Playwright to screenshot and calculate pixel diffs. This is:
- Slow (requires 10–30 seconds per render).
- Brittle (flaky across GPU drivers, font rendering, and OS versions).
- Heavy (hundreds of megabytes of binary dependencies).

LiteRouter evaluates web code via **native AST, CSS pattern, and semantic DOM analysis** directly in Bun. It checks what actually matters in code quality: layout landmarks, responsive classes, reactive state hooks, anti-placeholder cleanliness, and ARIA attributes.

---

## 📋 Stage Breakdown & Scoring Rubrics

### Stage 1: DOM Structure & Layout Fidelity (`stage1_structure.ts`)
- **Focus**: Evaluates layout hierarchy and modern CSS layout primitives.
- **Checks**:
  - **Structural Landmarks**: Requires semantic elements (`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`).
  - **Modern Layout Systems**: Checks for genuine CSS Grid (`grid-cols-3`) or Flexbox (`flex-col`, `items-center`).
  - **Anti-Overlap**: Penalizes brittle layout hacks like `position: absolute` with hardcoded pixel coordinates that collapse on resize.
- **Pass Threshold**: Score $\ge 70/100$.

### Stage 2: Responsive Scaling & Mobile Collapse (`stage2_responsive.ts`)
- **Focus**: Verifies mobile-first design and responsive viewport handling.
- **Checks**:
  - **Breakpoint Modifiers**: Requires responsive utility classes (`sm:`, `md:`, `lg:`).
  - **Mobile Column Collapse**: Asserts multi-column desktop grids collapse cleanly on mobile (e.g. `grid-cols-1 md:grid-cols-3` or `flex-col md:flex-row`).
  - **Fluid Containers**: Checks for fluid width classes (`w-full`, `max-w-7xl`) and penalizes fixed pixel widths (e.g. `w-[1200px]`) that cause horizontal overflow.
- **Pass Threshold**: Score $\ge 70/100$.

### Stage 3: Interactive State & Event Architecture (`stage3_state.ts`)
- **Focus**: Verifies genuine frontend reactivity and event handling.
- **Checks**:
  - **Reactive State Hooks**: Requires multiple `useState` or `useReducer` hooks.
  - **Controlled Inputs**: Verifies `<input>` elements are properly controlled with `value={...}` and `onChange={...}`.
  - **Form Submission**: Verifies forms implement genuine submit handlers with `e.preventDefault()`.
  - **Conditional UI Toggles**: Asserts interactive toggles (e.g. mobile drawer menu, modal visibility, filter dropdowns).
- **Pass Threshold**: Score $\ge 70/100$.

### Stage 4: Code Hygiene & Anti-Hallucination (`stage4_hygiene.ts`)
- **Focus**: Ensures production-ready, clean, secure code.
- **Checks**:
  - **Anti-Placeholder Cleanliness**: Penalizes lazy LLM placeholders (`TODO`, `<!-- implement here -->`, dummy placeholder boxes).
  - **Package Hallucination Detection**: Asserts that imports only use whitelisted, standard packages (`lucide-react`, `react`, `clsx`, `tailwind-merge`) and catches hallucinated non-existent npm packages.
  - **Security & Anti-XSS**: Checks for dangerous patterns like `dangerouslySetInnerHTML`, `eval()`, or raw unsanitized user interpolation.
- **Pass Threshold**: Score $\ge 80/100$.

### Stage 5: Semantic Accessibility & ARIA Compliance (`stage5_a11y.ts`)
- **Focus**: Enforces WCAG accessibility best practices.
- **Checks**:
  - **Clickable Semantics**: Replaces anti-pattern `<div onClick>` with semantic `<button type="button">`.
  - **Image Alt Coverage**: Verifies `<img>` tags provide meaningful `alt` text.
  - **Form Control Labels**: Asserts `<label htmlFor="...">` or `aria-label` bindings for all interactive inputs.
  - **Modal Dialog ARIA**: Verifies modal overlays use `role="dialog"` and `aria-modal="true"`.
- **Pass Threshold**: Score $\ge 70/100$.

---

## 🎨 In-Memory Mockup Fixtures (`fixtures.ts`)
Mockup fixtures are rendered using high-resolution SVG data URIs, enabling visual testing without disk I/O or external network dependencies:
- `SAAS_DASHBOARD_SVG`: Analytics dashboard with navbar, sidebar, 3 metric cards, and responsive chart containers.
- `PRICING_TABLE_SVG`: 3-tier SaaS pricing comparison with monthly/annual billing toggle.
- `AUTH_MODAL_ERROR_SVG`: Login modal with input validation error state.
