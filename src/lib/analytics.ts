const WELCOME_KEY = "omarchy-agents-welcome";

export function analyticsEnabled(): false {
  return false;
}

export function setAnalyticsEnabled(_enabled: boolean): void {}

export function initAnalytics(): Promise<void> {
  return Promise.resolve();
}

export function track(_event: string, _props?: Record<string, unknown>): void {}

export function emailGateDone(): boolean {
  try {
    return Boolean(localStorage.getItem(WELCOME_KEY));
  } catch {
    return false;
  }
}

export function setEmailGateDone(status: "submitted" | "skipped"): void {
  try {
    localStorage.setItem(WELCOME_KEY, status);
  } catch {}
}
