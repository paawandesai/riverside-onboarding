import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation } from "react-router";
import { api, type Signals, type SupportContent } from "../api";
import { track } from "../features/events";

export const IDLE_SECONDS = 45;

type ActionHandler = (action: string) => boolean;

type SupportApi = {
  card: SupportContent | null;
  /** Ask the server which card (if any) these signals warrant. */
  show: (signals: Partial<Signals>) => Promise<void>;
  /** Show a card the server already chose (e.g. returned with a chat turn). */
  present: (card: SupportContent | null) => void;
  dismiss: () => void;
  act: (action: string) => void;
  setPaused: (paused: boolean) => void;
  register: (handler: ActionHandler | null) => void;
  setGlobalHandler: (handler: ActionHandler) => void;
};

const SupportContext = createContext<SupportApi | null>(null);

export function SupportProvider({ children }: { children: ReactNode }) {
  const [card, setCard] = useState<SupportContent | null>(null);
  const stepHandler = useRef<ActionHandler | null>(null);
  const globalHandler = useRef<ActionHandler | null>(null);
  const paused = useRef(false);
  const { pathname } = useLocation();

  const present = useCallback(
    (next: SupportContent | null) => {
      setCard(next);
      if (next) track(stepId(pathname), `support_${next.trigger}`);
    },
    [pathname],
  );

  const show = useCallback(
    async (signals: Partial<Signals>) => {
      try {
        const { content } = await api.support(signals);
        if (content) present(content);
      } catch {
        // Supportive content is best-effort; the step itself still works.
      }
    },
    [present],
  );

  const dismiss = useCallback(() => setCard(null), []);
  const act = useCallback((action: string) => {
    setCard(null);
    if (stepHandler.current?.(action)) return;
    globalHandler.current?.(action);
  }, []);

  // A new step starts without the previous step's card.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on navigation
    setCard((c) => (c?.trigger === "distress" ? c : null));
  }, [pathname]);

  useIdleCard(pathname, card === null, paused, show);

  const value = useMemo<SupportApi>(
    () => ({
      card,
      show,
      present,
      dismiss,
      act,
      setPaused: (p) => (paused.current = p),
      register: (h) => (stepHandler.current = h),
      setGlobalHandler: (h) => (globalHandler.current = h),
    }),
    [card, show, present, dismiss, act],
  );
  return <SupportContext.Provider value={value}>{children}</SupportContext.Provider>;
}

export function useSupport(): SupportApi {
  const ctx = useContext(SupportContext);
  if (!ctx) throw new Error("useSupport outside SupportProvider");
  return ctx;
}

/** Let the current step handle card actions such as "Try again" or "Type it instead". */
export function useSupportActions(handler: ActionHandler) {
  const { register } = useSupport();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    register((a) => ref.current(a));
    return () => register(null);
  }, [register]);
}

const IDLE_STEPS = new Set(["chat", "details", "confirm", "book"]);

export function stepId(pathname: string): string {
  const id = pathname.replace(/^\//, "").replace(/\//g, "_") || "start";
  return id === "details_confirm" ? "confirm" : id;
}

/** One idle timer per step: resets on activity, pauses while hidden or a file picker is open, fires once per step. */
function useIdleCard(pathname: string, enabled: boolean, paused: RefObject<boolean>, show: SupportApi["show"]) {
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const step = stepId(pathname);
    if (!enabled || !IDLE_STEPS.has(step) || fired.current.has(step)) return;
    let last = Date.now();
    const reset = () => (last = Date.now());
    const events = ["keydown", "pointerdown", "input", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true, capture: true }));
    const timer = window.setInterval(() => {
      if (document.hidden || paused.current) {
        last = Date.now();
        return;
      }
      const idle = (Date.now() - last) / 1000;
      if (idle >= IDLE_SECONDS) {
        fired.current.add(step);
        window.clearInterval(timer);
        void show({ idle_seconds: Math.floor(idle) });
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, reset, { capture: true }));
    };
  }, [pathname, enabled, paused, show]);
}
