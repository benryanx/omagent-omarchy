// Read before main.tsx's first-paint writes: applySkin stamps omagent-skin on every boot.
const PRIOR_RUN_KEYS = ["omagent-skin", "omagent-installed", "omagent-email-gate", "omagent-drafts", "omagent-show-threads"];

export function hasPriorRun(store: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return PRIOR_RUN_KEYS.some((key) => store?.getItem(key) != null);
  } catch {
    return false;
  }
}
