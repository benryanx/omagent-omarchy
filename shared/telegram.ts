export interface TelegramStatus {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  botId: string | null;
  username: string | null;
  paired: boolean;
  pending: boolean;
  error: string | null;
}

export interface TelegramPairing {
  url: string;
  expiresAt: number;
}
