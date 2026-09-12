export type FailureAction = "fail_fast" | "retry_same_target" | "advance_target";

export const FAIL_FAST_STATUSES: ReadonlySet<number> = new Set([
  400, 404, 413, 414, 422, 451, 501, 505,
]);

export const KEY_ROTATION_STATUSES: ReadonlySet<number> = new Set([
  401, 403, 429,
]);

export const TRANSIENT_RETRY_STATUSES: ReadonlySet<number> = new Set([
  500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526,
]);

/**
 * Deterministically classifies upstream HTTP status codes into failure actions.
 */
export function defaultClassifyFailure(status: number): FailureAction {
  if (FAIL_FAST_STATUSES.has(status)) {
    return "fail_fast";
  }
  if (KEY_ROTATION_STATUSES.has(status)) {
    return "retry_same_target";
  }
  if (TRANSIENT_RETRY_STATUSES.has(status)) {
    return "retry_same_target";
  }
  return "fail_fast";
}
