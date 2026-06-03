// Pricing-region primitives. Tiny, dependency-free module so proxy.ts (middleware) can
// import the region constants without pulling in the full pricing dataset.

export type Region = "ch" | "it";
export const REGIONS: Region[] = ["ch", "it"];
export const DEFAULT_REGION: Region = "ch";
export const REGION_COOKIE = "MDS_REGION";

export const isRegion = (x: string | undefined | null): x is Region => x === "ch" || x === "it";

// Currency symbol shown before the amount, per region.
export const CURRENCY: Record<Region, string> = { ch: "CHF", it: "€" };
