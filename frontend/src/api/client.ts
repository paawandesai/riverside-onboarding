import type { components } from "./schema";

export type Schemas = components["schemas"];

/** How the UI should recover from a failed call: try again, switch to a form, or finish with staff. */
export type Recovery = "retry" | "fallback" | "staff";

export class ApiError extends Error {
  status: number;
  fieldErrors: { field: string; message: string }[];
  body: unknown;
  constructor(status: number, message: string, body: unknown = null, fieldErrors: { field: string; message: string }[] = []) {
    super(message);
    this.status = status;
    this.body = body;
    this.fieldErrors = fieldErrors;
  }

  get recovery(): Recovery {
    if (this.status === 503 || this.status === 422) return "fallback";
    if (this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500) return "retry";
    return "staff";
  }
}

// Sent on every call; the API rejects mutations without it (CSRF guard).
const CSRF_HEADERS = { "X-Requested-With": "onboarding-app" };
const DEFAULT_TIMEOUT_MS = 20_000;

type Options = {
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function request<T>(method: string, path: string, opts: Options = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", forwardAbort, { once: true });
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: opts.form ? CSRF_HEADERS : { ...CSRF_HEADERS, "Content-Type": "application/json" },
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(controller.signal.aborted ? 408 : 0, "We couldn't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", forwardAbort);
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const obj = (data ?? {}) as { detail?: unknown; errors?: unknown };
    const detail = typeof obj.detail === "string" ? obj.detail : "Something went wrong. Please try again.";
    throw new ApiError(res.status, detail, data, Array.isArray(obj.errors) ? obj.errors : []);
  }
  return data as T;
}
