type Reply = { status?: number; body?: unknown };
type Handler = (url: string, init?: RequestInit) => Reply;

export type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

/** Route table for fetch: "METHOD /path" -> reply. Records every call for assertions. */
export function mockFetch(routes: Record<string, Handler | Reply>) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown = init?.body;
    if (typeof body === "string") body = JSON.parse(body);
    calls.push({ method, url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(routes)
      .filter((k) => {
        const [m, path] = k.split(" ");
        return m === method && (url === path || url.startsWith(`${path}?`) || url.startsWith(path));
      })
      .sort((a, b) => b.length - a.length)[0];
    const route = key ? routes[key] : { status: 404, body: { detail: "not mocked" } };
    const { status = 200, body: out = {} } = typeof route === "function" ? route(url, init) : route;
    return { ok: status < 400, status, json: async () => out } as Response;
  }) as typeof fetch;
  return calls;
}
