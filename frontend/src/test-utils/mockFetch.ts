type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown };

export function mockFetch(routes: Record<string, Handler | { status?: number; body?: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => {
      const [method, path] = k.split(" ");
      return (init?.method ?? "GET") === method && url.startsWith(path);
    });
    const route = key ? routes[key] : { status: 404, body: { detail: "not mocked" } };
    const { status = 200, body = {} } = typeof route === "function" ? route(url, init) : route;
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as jest.Mock;
  return calls;
}
