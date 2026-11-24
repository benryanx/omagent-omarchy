/** Private responses for the signed-in person's Vault UI; never include these in model tool results. */
export interface AgentcardStatus {
  configured: boolean;
  credentialSource?: "environment" | "saved" | null;
  canConfigure?: boolean;
  linked: boolean;
  cards: Array<{ id: string; brand: string; last4: string; expiryMonth: number; expiryYear: number; autoApproval?: "pending" | "active" | "revoked" | "retired" | "unavailable" }>;
  enrollment: { url: string; expiresAt: number; intent?: "connect" | "add" | "auto_approval" } | null;
  checkouts: Array<{
    id: string;
    merchant: string;
    amount: number;
    currency: string;
    status: string;
    approvalUrl: string | null;
    orderId?: string;
  }>;
}
