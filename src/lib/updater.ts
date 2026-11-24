import { useEffect, useState } from "react";
import type { UpdaterState } from "@/types/omagent";

export type { UpdaterState };

export function useUpdaterState(): UpdaterState | null {
  const [state, setState] = useState<UpdaterState | null>(null);
  useEffect(() => window.omagent?.updater?.onState(setState), []);
  return window.omagent?.updater ? state : null;
}
