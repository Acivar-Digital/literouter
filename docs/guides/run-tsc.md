# TypeScript Verification with Bun (`tsc --noEmit`)

## 1. What is the Issue?

### The Bun Runtime Paradox: Fast Execution vs. Zero Type Verification
[Bun](https://bun.sh) natively executes TypeScript (`.ts`) files out-of-the-box with zero configuration. However, **Bun does not check types at runtime**. 

Instead, Bun performs **type stripping (type erasure)**:
- It strips out type annotations, interfaces, generics, and type casts using an internal transpiler (similar to esbuild/swc).
- It executes the underlying JavaScript directly without validating whether the types match runtime expectations.

### Why Relying Solely on Bun Causes Failures
If you rely only on `bun run` or `bun test` without running the TypeScript compiler (`tsc`):
1. **Silent Type Errors**: Code like `const port: number = "7766";` or passing invalid object keys will execute without any warning.
2. **Runtime Exceptions**: Type mismatches turn into downstream runtime errors (e.g., `TypeError: Cannot read properties of undefined` or `undefined is not a function`).
3. **AI / LLM Agent Hallucinations**: Coding agents often hallucinate function signatures, modify interfaces in one file, and forget to update call sites across the codebase. Bun will happily execute the broken code until an integration test or live request triggers the crash.

---

## 2. How Should We Implement This?

To achieve maximum runtime performance while maintaining strict type guarantees, separate **execution** from **type checking**.

### A. Separation of Concerns
| Role | Tool | Responsibility | Command |
|---|---|---|---|
| **Runtime Execution** | **Bun** | Ultra-fast execution, hot reloading, bundled test runner | `bun run src/index.ts`<br>`bun test` |
| **Static Verification** | **TypeScript (`tsc`)** | Full AST type-checking across project files (without emitting JS) | `bun run typecheck`<br>(`tsc --noEmit`) |
| **Code Hygiene** | **Ruff** | Python linters / smoke test scripts | `uv run ruff check .` |

### B. Configuration Setup

#### 1. `tsconfig.json`
Configure `tsconfig.json` with strict type settings and `"noEmit": true` so TypeScript acts purely as a static analyzer:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": [
      "bun"
    ]
  },
  "include": [
    "src/**/*.ts",
    "scripts/**/*.ts",
    "tests/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    ".checkpoints",
    "logs"
  ]
}
```

#### 2. `package.json` Scripts
Register the typecheck script in `package.json`:
```json
{
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

### C. Developer & Agent Workflow

1. **Active Development**:
   Run the gateway or scripts directly with Bun for rapid iteration:
   ```bash
   bun dev
   ```

2. **Pre-Commit / Pre-PR Quality Gate**:
   Before pushing changes or completing a task, always execute:
   ```bash
   bun run typecheck
   ```

3. **Combined Test Gate**:
   Ensure both static type checking and dynamic tests pass:
   ```bash
   bun run typecheck && bun test && uv run pytest tests/integration/
   ```

---

## 3. What Can We Expect?

### Benefits & Expected Outcomes

1. **Zero Build Clutter (`--noEmit`)**:
   - `tsc` will not emit `.js`, `.js.map`, or `.d.ts` files into your project folders.
   - The repository remains clean with zero artifact overhead.

2. **Early Catch of Refactoring Drifts**:
   - Any rename of an interface, route config, or options object will be immediately surfaced with exact file paths and line numbers before running code.

3. **Prevention of AI Hallucinations**:
   - LLMs editing TypeScript files are prevented from introducing bogus arguments, mismatched return types, or nonexistent imports.

4. **Zero Runtime Overhead**:
   - Because `tsc --noEmit` runs offline / in CI / pre-commit, your production Bun runtime remains at 100% native speed with zero latency penalty.

5. **Deterministic CI/CD Pipeline**:
   - CI fails fast on pure type errors in seconds without needing to wait for expensive upstream network calls or end-to-end integration timeouts.
