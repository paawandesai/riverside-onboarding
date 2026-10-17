export type AddressParts = { street: string; city: string; state: string; zip: string };

/**
 * Split an address read from an ID ("STREET, CITY ST 12345"). Each part is taken only when it's
 * clearly there; anything we can't identify stays empty for the patient to fill. Nothing is guessed.
 */
export function splitAddress(value: string | null | undefined): AddressParts {
  const parts = { street: "", city: "", state: "", zip: "" };
  if (!value?.trim()) return parts;
  const comma = value.indexOf(",");
  if (comma < 0) return { ...parts, street: value.trim() };
  parts.street = value.slice(0, comma).trim();
  let rest = value.slice(comma + 1).trim().replace(/,/g, " ");
  const zip = /\s*(\d{5})(?:-\d{4})?$/.exec(rest);
  if (zip) {
    parts.zip = zip[1];
    rest = rest.slice(0, zip.index).trim();
  }
  const state = /\s+([A-Za-z]{2})$/.exec(rest);
  if (state) {
    parts.state = state[1].toUpperCase();
    rest = rest.slice(0, state.index).trim();
  }
  parts.city = rest.replace(/\s+/g, " ");
  return parts;
}

export function joinAddress(p: AddressParts): string {
  return `${p.street.trim()}, ${p.city.trim()} ${p.state.trim().toUpperCase()} ${p.zip.trim()}`;
}
