import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import type { AgentcardStatus } from "../../shared/agentcard";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import logo from "@/assets/agentcard/logo.png";

function useVault() {
  const [status, replaceStatus] = useState<AgentcardStatus | null>(null);
  const revision = useRef(0);
  const setStatus = useCallback((next: AgentcardStatus) => { revision.current++; replaceStatus(next); }, []);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = revision.current;
    const next = await api<AgentcardStatus>("/api/integrations/agentcard", { signal, background: true });
    if (version !== revision.current) return;
    replaceStatus(next); setError(null);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try { await refresh(controller.signal); }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("agentcard.vaultUnavailable")); }
      finally { pending = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  return { status, setStatus, error, setError };
}

const button = "inline-flex items-center justify-center gap-2 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50";

export function AgentcardVaultSettings() {
  const { status, setStatus, error, setError } = useVault();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text/plain");
    const id = /^\s*AGENTCARD_CLIENT_ID\s*=\s*["']?([^\s"']+)["']?\s*$/m.exec(text)?.[1];
    const secret = /^\s*AGENTCARD_CLIENT_SECRET\s*=\s*["']?([^\s"']+)["']?\s*$/m.exec(text)?.[1];
    if (id && secret) { event.preventDefault(); setClientId(id); setClientSecret(secret); }
  };
  const save = async () => {
    setBusy(true); setSaveError(null);
    try {
      setStatus(await api<AgentcardStatus>("/api/integrations/agentcard/credentials", { method: "PUT", body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }) }));
      setClientId(""); setClientSecret(""); setEditing(false);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : t("agentcard.vaultUnavailable")); }
    finally { setBusy(false); }
  };
  const enroll = async (intent: "connect" | "add" | "auto_approval" = status?.cards?.length ? "add" : "connect") => {
    setBusy(true); setError(null);
    try { setStatus(await api<AgentcardStatus>("/api/integrations/agentcard/enroll", { method: "POST", body: JSON.stringify({ intent }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("agentcard.vaultUnavailable")); }
    finally { setBusy(false); }
  };
  return <section className="rounded-xl border border-hairline/40 bg-card p-4" aria-labelledby="agentcard-vault-title">
    <div className="mb-2 flex items-center gap-2"><img src={logo} alt="" className="size-6 rounded" /><h3 id="agentcard-vault-title" className="font-medium">{t("agentcard.vaultTitle")}</h3></div>
    <p className="mb-3 text-[13px] text-ink-secondary">{t("agentcard.vaultDescription")}</p>
    {status && <>
      <p role="status" className="mb-3 text-[13px] text-ink-secondary">{t(!status.configured ? (status.canConfigure === false ? "agentcard.vaultAdminCredentials" : "agentcard.vaultEnterCredentials") : status.cards?.length ? "agentcard.vaultLinked" : status.linked ? "agentcard.vaultEmpty" : "agentcard.vaultUnlinked")}</p>
      {status.canConfigure !== false && status.credentialSource !== "environment" && (!status.configured || editing) && <form className="mb-4 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <p className="text-[13px] text-ink-secondary">{t("agentcard.vaultCredentialHelp")} <a href="https://app.agentcard.sh" target="_blank" rel="noreferrer" className="text-accent underline">{t("agentcard.vaultDashboard")}</a></p>
        <label className="text-[13px]">{t("agentcard.vaultClientId")}<input type="text" autoComplete="off" spellCheck={false} value={clientId} onPaste={paste} onChange={event => setClientId(event.target.value)} disabled={busy}
          className="mt-1 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink" placeholder="AGENTCARD_CLIENT_ID" /></label>
        <label className="text-[13px]">{t("agentcard.vaultClientSecret")}<input type="password" autoComplete="new-password" spellCheck={false} value={clientSecret} onPaste={paste} onChange={event => setClientSecret(event.target.value)} disabled={busy}
          className="mt-1 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink" placeholder="AGENTCARD_CLIENT_SECRET" /></label>
        <p className="text-[12px] text-ink-secondary">{t("agentcard.vaultCredentialStorage")}</p>
        <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={busy || !clientId.trim() || !clientSecret.trim()}>{t(busy ? "agentcard.vaultSavingCredentials" : "agentcard.vaultSaveCredentials")}</button>
          {editing && <button type="button" className={button} disabled={busy} onClick={() => { setEditing(false); setClientId(""); setClientSecret(""); setSaveError(null); }}>{t("agentcard.vaultCancelCredentials")}</button>}</div>
        {saveError && <p role="alert" className="text-[13px] text-danger">{saveError}</p>}
      </form>}
      {status.credentialSource === "environment" && <p className="mb-3 text-[12px] text-ink-secondary">{t("agentcard.vaultCredentials")}</p>}
      {status.configured && status.canConfigure !== false && status.credentialSource !== "environment" && !editing && <button type="button" className={`${button} mb-3`} onClick={() => setEditing(true)}>{t("agentcard.vaultChangeCredentials")}</button>}
      {status.cards?.map(card => <p key={card.id} className="mb-3 text-[13px] text-ink-secondary">{card.brand} · •••• {card.last4} · {String(card.expiryMonth).padStart(2, "0")}/{card.expiryYear}</p>)}
      {Boolean(status.cards?.length) && <div className="mb-3 text-[13px] text-ink-secondary">
        <p>{t(status.cards.some(card => card.autoApproval === "active") ? "agentcard.vaultAutoActive" : "agentcard.vaultAutoHelp")}</p>
        {!status.cards.some(card => card.autoApproval === "active") && <button type="button" className={`${button} mt-2`} disabled={busy || editing || Boolean(status.enrollment)} onClick={() => void enroll("auto_approval")}>{t("agentcard.vaultEnableAuto")}</button>}
      </div>}
      {status.configured && <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || editing || Boolean(status.enrollment)} onClick={() => void enroll()}><CreditCard size={14} />{t(status.cards?.length ? "agentcard.vaultAddCard" : status.linked ? "agentcard.vaultFinish" : "agentcard.vaultConnect")}</button>
        {status.enrollment && <a className={button} href={status.enrollment.url} target="_blank" rel="noreferrer">{t(status.enrollment.intent === "auto_approval" ? "agentcard.vaultOpenAuto" : "agentcard.vaultOpen")}<ExternalLink size={14} /></a>}
      </div>}
      {status.enrollment && <p className="mt-2 text-[12px] text-ink-secondary">{t("agentcard.vaultEnrollmentNotice")}</p>}
      {status.checkouts?.map(row => <div key={row.id} className="mt-3 rounded-lg bg-inset p-3 text-[13px]">
        <p className="font-medium">{row.merchant} · {row.currency.toUpperCase()} {formatAmount(row.amount, row.currency)}</p>
        <p className="mt-1 text-ink-secondary">{row.status === "completed" && row.orderId ? t("agentcard.vaultOrder", { id: row.orderId }) : t("agentcard.vaultPending")}</p>
        {row.approvalUrl && <a className={`${button} mt-2`} href={row.approvalUrl} target="_blank" rel="noreferrer">{t("agentcard.vaultApprove")}<ExternalLink size={14} /></a>}
      </div>)}
    </>}
    {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
    <a href="https://docs.agentcard.sh/vault/adding-a-card" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent underline">{t("agentcard.vaultGuide")}<ExternalLink size={12} /></a>
  </section>;
}

export function AgentcardApprovalBanner() {
  const { status } = useVault();
  const pending = status?.checkouts?.filter(row => row.approvalUrl) ?? [];
  if (!pending.length) return null;
  return <aside aria-label={t("agentcard.vaultApprovals")} className="z-40 flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline bg-card px-4 py-3 text-[13px]">
    <CreditCard size={18} aria-hidden="true" />
    {pending.map(row => <div key={row.id} className="flex flex-wrap items-center gap-3">
      <span>{row.merchant} · {row.currency.toUpperCase()} {formatAmount(row.amount, row.currency)}</span>
      <a href={row.approvalUrl!} target="_blank" rel="noreferrer" className={button}>{t("agentcard.vaultApprove")}<ExternalLink size={14} /></a>
    </div>)}
    <span className="text-ink-secondary">{t("agentcard.vaultApprovalNotice")}</span>
  </aside>;
}

function formatAmount(amount: number, currency: string): string {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return (amount / 10 ** digits).toFixed(digits);
}
