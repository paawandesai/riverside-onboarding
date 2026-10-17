import en from "./en.json";

export type MessageKey = keyof typeof en;

/** Look up a UI string and fill {placeholders}. Strings live in en.json so translation is a data change. */
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
