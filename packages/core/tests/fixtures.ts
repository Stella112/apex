import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/live/${name}.json`, import.meta.url)), "utf8"));
}
