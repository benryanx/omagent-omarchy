// Exact app-owned browser state that belongs in an encrypted full backup.
// Never include cookies, authentication tokens, connection caches or unknown keys.
export const WORKSPACE_BACKUP_CLIENT_KEYS = [
  "omagent-drafts",
  "omagent-draft-attachments",
  "omagent-draft-send-ids",
  "omagent-draft-channel-modes",
  "omagent-skin",
  "omagent-show-threads",
  "omagent-show-run-card",
  "omagent-send-key",
  "omagent-color-user-bubbles",
  "omagent-chat-width",
  "omagent.sidebarDensity",
  "omagent.sidebarToolsLayout",
  "omagent.sidebarCollapsedSections.v1",
  "omagent.sidebarSectionOrder.v1",
  "omagent-analytics-opt-out",
  "omagent.remote-voice.v1",
] as const;

export type WorkspaceBackupClientState = Partial<Record<(typeof WORKSPACE_BACKUP_CLIENT_KEYS)[number], string>>;
