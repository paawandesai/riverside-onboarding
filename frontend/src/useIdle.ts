import { useEffect, useRef } from "react";

/**
 * Calls onIdle once after `thresholdSeconds` without keyboard, pointer or touch activity.
 * Fires again only after the user becomes active and then goes idle again.
 */
export function useIdleTrigger(thresholdSeconds: number, enabled: boolean, onIdle: (idleSeconds: number) => void): void {
  const callback = useRef(onIdle);
  useEffect(() => {
    callback.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    let fired = false;
    const bump = () => {
      last = Date.now();
      fired = false;
    };
    const events = ["keydown", "pointerdown", "touchstart", "input"];
    events.forEach((e) => window.addEventListener(e, bump));
    const timer = window.setInterval(() => {
      const idle = Math.floor((Date.now() - last) / 1000);
      if (!fired && idle >= thresholdSeconds) {
        fired = true;
        callback.current(idle);
      }
    }, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(timer);
    };
  }, [thresholdSeconds, enabled]);
}
