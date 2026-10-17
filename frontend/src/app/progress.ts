import type { Progress } from "../api";

/** Where a returning patient should continue. */
export function nextPath(p: Progress): string {
  if (!p.consent) return "/consent";
  if (!p.assessment_done) return "/chat";
  if (!p.identity_done) return "/details";
  if (!p.booked) return "/book";
  return "/done";
}
