import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { makeQueryClient, Providers } from "../app/Providers";
import { routes } from "../app/router";

/** Render the real app at a path, with the real router, providers and lazy steps. */
export function renderApp(path: string, state?: unknown) {
  const router = createMemoryRouter(routes, { initialEntries: [{ pathname: path.split("?")[0], search: path.includes("?") ? `?${path.split("?")[1]}` : "", state }] });
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const utils = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router };
}

export const ME = { id: "u1", role: "user" };
export const PROGRESS = { consent: true, photo_scan: false, assessment_done: false, identity_done: false, booked: false };

/** axe-core accessibility check; returns rule ids of any violations (empty means none). */
export async function axeViolations(container: Element): Promise<string[]> {
  const axe = (await import("axe-core")).default;
  // Colour contrast needs real layout and CSS, which jsdom doesn't have; the e2e axe pass covers it.
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}
