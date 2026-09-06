export type ProviderCode =
  | "or"
  | "nv"
  | "gg"
  | "oa"
  | "an"
  | "gq"
  | "cb"
  | "ds"
  | "ms"
  | "tg"
  | "zn"
  | "tp"
  | "gc";

export type WireProtocol = "oa" | "oo" | "cl" | "gg" | "rs" | "ao";

export type PayloadCode = WireProtocol;

export type CompletionCode =
  | "ch"
  | "ms"
  | "ob"
  | "gc"
  | "im"
  | "em"
  | "au"
  | "md"
  | "rs";

export type NuanceCode = "no" | "dp" | "ts" | "gm" | "g3" | "sb" | "tc" | "lg";

export interface DirectDirective {
  readonly type: "direct";
  readonly raw: string;
  readonly provider: ProviderCode;
  readonly payload: PayloadCode;
  readonly wire?: WireProtocol;
  readonly completion: CompletionCode;
  readonly endpoint?: CompletionCode;
  readonly nuances: readonly NuanceCode[];
  readonly reasoning?: string;
}

export interface FusionDirective {
  readonly type: "fusion";
  readonly raw: string;
  readonly preset: string;
}

export type ParsedDirective = DirectDirective | FusionDirective;

const VALID_PROVIDERS: ReadonlySet<string> = new Set([
  "or",
  "nv",
  "gg",
  "oa",
  "an",
  "gq",
  "cb",
  "ds",
  "ms",
  "tg",
  "zn",
  "tp",
  "gc",
]);

const VALID_PAYLOADS: ReadonlySet<string> = new Set(["oa", "oo", "cl", "gg", "rs", "ao"]);

const VALID_COMPLETIONS: ReadonlySet<string> = new Set([
  "ch",
  "ms",
  "ob",
  "gc",
  "im",
  "em",
  "au",
  "md",
  "rs",
]);

const VALID_NUANCES: ReadonlySet<string> = new Set([
  "no",
  "dp",
  "ts",
  "gm",
  "g3",
  "sb",
  "tc",
  "lg",
]);

export function parseNuanceTokens(token: string): readonly NuanceCode[] | null {
  if (token.length === 0) {
    return null;
  }
  const parts = token.split("+");
  const parsed: NuanceCode[] = [];
  for (const part of parts) {
    if (!VALID_NUANCES.has(part)) {
      return null;
    }
    parsed.push(part as NuanceCode);
  }
  return Object.freeze(parsed);
}

function isValidCode(code: string | undefined, validSet: ReadonlySet<string>): boolean {
  if (!code) {
    return false;
  }
  return validSet.has(code);
}

function areDirectCodesValid(p: string | undefined, pl: string | undefined, c: string | undefined): boolean {
  const pOk = isValidCode(p, VALID_PROVIDERS);
  const plOk = isValidCode(pl, VALID_PAYLOADS);
  const cOk = isValidCode(c, VALID_COMPLETIONS);
  return pOk && plOk && cOk;
}

function createDirectDirective(
  parts: readonly string[],
  raw: string,
  nuances: readonly NuanceCode[]
): DirectDirective {
  const payload = parts[2] as PayloadCode;
  const completion = parts[3] as CompletionCode;
  return {
    type: "direct",
    raw,
    provider: parts[1] as ProviderCode,
    payload,
    wire: payload,
    completion,
    endpoint: completion,
    nuances,
    reasoning: parts[4],
  };
}

function parseDirectKey(
  parts: readonly string[],
  raw: string
): DirectDirective | null {
  if (parts.length !== 5) {
    return null;
  }
  if (!areDirectCodesValid(parts[1], parts[2], parts[3])) {
    return null;
  }
  const nuancePart = parts[4] as string;
  const nuances = parseNuanceTokens(nuancePart);
  if (nuances === null) {
    return null;
  }
  return createDirectDirective(parts, raw, nuances);
}

function parseFusionKey(
  parts: readonly string[],
  raw: string
): FusionDirective | null {
  if (parts.length !== 3) {
    return null;
  }
  if (parts[1] !== "fse") {
    return null;
  }
  const preset = parts[2];
  if (!preset) {
    return null;
  }
  return {
    type: "fusion",
    raw,
    preset,
  };
}

export function isDirectDirective(d: ParsedDirective): d is DirectDirective {
  return d.type === "direct";
}

export function isFusionDirective(d: ParsedDirective): d is FusionDirective {
  return d.type === "fusion";
}

export function parseDirective(rawKey: string): ParsedDirective | null {
  const normalized = rawKey.trim().toLowerCase();
  if (!normalized.startsWith("lr-")) {
    return null;
  }
  const parts = normalized.split("-");
  if (parts[1] === "fse") {
    return parseFusionKey(parts, normalized);
  }
  if (parts.length === 5) {
    return parseDirectKey(parts, normalized);
  }
  return null;
}
