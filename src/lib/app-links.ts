export const APP_NAME = "Omagent";
export const APP_REPOSITORY = "https://github.com/benryanx/omagent-omarchy";
export const DOCS_URL = `${APP_REPOSITORY}/tree/main/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${APP_REPOSITORY}/blob/main/docs/approval-levels.md`;
export const PASSKEY_HELP_URL = "";
export const FEEDBACK_URL = "";
export const RELEASES_URL = `${APP_REPOSITORY}/releases`;
export const PRICING_URL = "";
export function withSource(url: string, source: string): string {
  const target = new URL(url);
  target.searchParams.set("src", source);
  return target.href;
}
export const LICENSE_URL = `${APP_REPOSITORY}/blob/main/LICENSE`;
export const IOS_APP_STORE_URL = "";
export const ANDROID_APK_URL = "";

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

export async function openExternalLink(url: string): Promise<void> {
  if (!url || new URL(url, window.location.origin).hostname.endsWith(".invalid")) throw new Error("This Omagent service is not available yet.");
  if (window.omagent?.openExternal) {
    await window.omagent.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** A browser hands a mailto: link to its own mail app; the desktop app's window may not navigate to one, so main opens it. */
export async function openEmailDraft(url: string): Promise<void> {
  if (window.omagent) return openExternalLink(url);
  window.location.href = url;
}
