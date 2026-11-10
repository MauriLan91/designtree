// The inspector's Compatible field. Every real compatible has a vendor
// comma (`acme,first-board`), so the comma cannot separate the strings:
// whitespace does, and a comma at the end of one (`a,b, c,d`) or DTS quotes
// (`"a,b", "c,d"`) are dropped.

export function parseCompatible(text: string): string[] {
  return text
    .split(/\s+/)
    .map((s) => s.replace(/^"|",?$|,$/g, ""))
    .filter(Boolean);
}

export const formatCompatible = (list: string[]) => list.join(", ");
