import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, Send } from "lucide-react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import type { TelegramPairing, TelegramStatus } from "../../shared/telegram";
import { McpServersPanel } from "./McpServersPanel";
import { AgentcardVaultSettings } from "./AgentcardVault";

const button = "rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50";
const input = "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink";
const noop = () => {};
const agentcardOnly = { shown: (id: string) => id === "agentcard", onConnections: noop };

export function IntegrationsSettings() {
  const { state } = useStore();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState("");
  const [botId, setBotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [now, setNow] = useState(Date.now());
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await api<TelegramStatus>("/api/integrations/telegram", { signal });
    setStatus(next);
    setBotId(current => current || next.botId || state.bots?.find(bot => !bot.hidden)?.id || "");
    if (next.paired) setPairing(null);
  }, [state.bots]);
  useEffect(() => {
    const controller = new AbortController();
    const read = () => { setNow(Date.now()); void refresh(controller.signal).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("integrations.loadFailed"));
    }); };
    read(); const timer = setInterval(read, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("integrations.saveFailed")); }
    finally { setBusy(false); }
  };
  const save = (enabled = true) => run(async () => {
    const next = await api<TelegramStatus>("/api/integrations/telegram", {
      method: "PUT", body: JSON.stringify({ botId, enabled, ...(token.trim() ? { token: token.trim() } : {}) }),
    });
    setToken(""); setStatus(next); setPairing(null);
  });
  const disconnected = !status?.configured;
  return <div className="flex flex-col gap-5" data-integrations-settings>
    <section className="rounded-xl border border-hairline/40 bg-card p-4" aria-labelledby="telegram-settings-title">
      <div className="mb-2 flex items-center gap-2"><Send size={18} aria-hidden="true" /><h3 id="telegram-settings-title" className="font-medium">Telegram</h3></div>
      <p className="mb-3 text-[13px] text-ink-secondary">{t("telegram.description")}</p>
      {!status && <p role="status" className="text-[13px] text-ink-secondary">{t("telegram.loading")}</p>}
      {status && !status.available && <p className="text-[13px] text-ink-secondary">{t("telegram.personalOnly")}</p>}
      {status?.available && <div className="flex flex-col gap-3">
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-secondary">
          <li>{t("telegram.stepCreate")} <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent underline">@BotFather</a>.</li>
          <li>{t("telegram.stepConnect")}</li><li>{t("telegram.stepPair")}</li>
        </ol>
        <label className="text-[13px]">{t("telegram.token")}<input className={`${input} mt-1`} type="password" autoComplete="off" spellCheck={false}
          value={token} onChange={event => setToken(event.target.value)} placeholder={status.configured ? t("telegram.tokenSaved") : "123456789:…"} disabled={busy || status.pending} /></label>
        <label className="text-[13px]">{t("telegram.bot")}<select className={`${input} mt-1`} value={botId} onChange={event => setBotId(event.target.value)} disabled={busy || status.pending}>
          <option value="">{t("telegram.chooseBot")}</option>
          {state.bots?.filter(bot => !bot.hidden).map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
        </select></label>
        <p role="status" className="text-[13px] text-ink-secondary">{disconnected ? t("telegram.disconnected") : status.paired
          ? t(status.enabled ? "telegram.connected" : "telegram.paused", { username: status.username ?? "" })
          : t("telegram.unpaired", { username: status.username ?? "" })}</p>
        {status.pending && <p className="text-[13px] text-ink-secondary">{t("telegram.pending")}</p>}
        <div className="flex flex-wrap gap-2">
          {status.pending && <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
            setStatus(await api<TelegramStatus>("/api/integrations/telegram/stop", { method: "POST", body: "{}" }));
          })}>{t("telegram.stop")}</button>}
          <button type="button" className={button} disabled={busy || !botId || status.pending || (disconnected && !token.trim())} onClick={() => void save()}>{t(disconnected ? "telegram.connect" : "telegram.save")}</button>
          {status.configured && !status.paired && status.enabled && <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
            setPairing(await api<TelegramPairing>("/api/integrations/telegram/pair", { method: "POST", body: "{}" }));
          })}>{t("telegram.pair")}</button>}
          {status.configured && <>
            <button type="button" className={button} disabled={busy || status.pending} onClick={() => void save(!status.enabled)}>{t(status.enabled ? "telegram.pause" : "telegram.resume")}</button>
            <button type="button" className={button} disabled={busy || status.pending} onClick={() => void run(async () => {
              setStatus(await api<TelegramStatus>("/api/integrations/telegram", { method: "DELETE" })); setPairing(null); setToken("");
            })}>{t("telegram.disconnect")}</button>
          </>}
        </div>
        {pairing && (pairing.expiresAt > now ? <div className="rounded-lg bg-control p-3 text-[13px]">
          <a href={pairing.url} target="_blank" rel="noreferrer" className="text-accent underline">{t("telegram.openPairing")}</a>
          <p className="mt-1 text-ink-secondary">{t("telegram.pairingNotice")}</p>
        </div> : <p className="text-[13px] text-ink-secondary">{t("telegram.pairingExpired")}</p>)}
        <p className="text-[12px] text-ink-tertiary">{t("telegram.runtimeNotice")}</p>
      </div>}
      {(error || status?.error) && <p role="alert" className="mt-3 text-[13px] text-danger">{error || status?.error}</p>}
    </section>
    <AgentcardVaultSettings />
    <section aria-labelledby="agentcard-setup-title" className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><CreditCard size={18} aria-hidden="true" /><h3 id="agentcard-setup-title" className="font-medium">{t("agentcard.personalTitle")}</h3></div>
      <p className="text-[13px] text-ink-secondary">{t("agentcard.setupDescription")}</p>
      <McpServersPanel embedded hostedCards={agentcardOnly} />
      <div className="flex flex-wrap gap-3 text-[13px]">
        <a href="https://docs.agentcard.com/getting-started" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent underline">{t("agentcard.setupGuide")}<ExternalLink size={12} /></a>
        <a href="https://docs.agentcard.com/commerce-mcp" target="_blank" rel="noreferrer" className="text-accent underline">{t("agentcard.developerGuide")}</a>
      </div>
    </section>
  </div>;
}
