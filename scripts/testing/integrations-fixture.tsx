import { createRoot } from "react-dom/client";
import { StoreProvider } from "../../src/state/store";
import { IntegrationsSettings } from "../../src/components/IntegrationsSettings";
import { applySkinChoice, readSkinChoice } from "../../src/lib/skins";
import "../../src/styles.css";

applySkinChoice(readSkinChoice());
createRoot(document.getElementById("root")!).render(<StoreProvider><main className="min-h-screen bg-app p-6 text-ink"><div className="mx-auto max-w-2xl"><h1 className="mb-5 text-xl">Messaging &amp; payments</h1><IntegrationsSettings /></div></main></StoreProvider>);
