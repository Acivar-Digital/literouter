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
  | "zn";

export type PayloadCode = "oa" | "cl" | "gg" | "rs";

export type CompletionCode =
  | "ch"
  | "ms"
  | "ob"
  | "gc"
  | "im"
  | "em"
  | "au"
  | "md";

export type NuanceCode = "no" | "dp" | "ts" | "gm" | "g3" | "sb" | "tc";

export interface DirectDirective {
  readonly type: "direct";
  readonly raw: string;
  readonly provider: ProviderCode;
  readonly payload: PayloadCode;
  readonly completion: CompletionCode;
  readonly nuances: readonly NuanceCode[];
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
]);

const VALID_PAYLOADS: ReadonlySet<string> = new Set(["oa", "cl", "gg", "rs"]);

const VALID_COMPLETIONS: ReadonlySet<string> = new Set([
  "ch",
  "ms",
  "ob",
  "gc",
  "im",
  "em",
  "au",
  "md",
]);

const VALID_NUANCES: ReadonlySet<string> = new Set([
  "no",
  "dp",
  "ts",
  "gm",
  "g3",
  "sb",
  "tc",
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
  return {
    type: "direct",
    raw,
    provider: parts[1] as ProviderCode,
    payload: parts[2] as PayloadCode,
    completion: parts[3] as CompletionCode,
    nuances,
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
