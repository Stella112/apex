// Builds the Apex service from the repo .env (shared by the stdio and HTTP entry points).
import { Apex, type StrikeEnv } from "@apex/core";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: `${ROOT}.env`, quiet: true });

export function apexFromEnv(): Apex {
  return new Apex({
    env: (process.env.STRIKE_ENV ?? "mainnet") as StrikeEnv,
    publicKey: process.env.STRIKE_API_PUBLIC_KEY?.trim() || undefined,
    privateKey: process.env.STRIKE_API_PRIVATE_KEY?.trim() || undefined,
    apexMode: process.env.APEX_MODE === "live" ? "live" : "paper",
    stateDir: process.env.APEX_STATE_DIR || `${ROOT}logs`,
    logSigningKey: process.env.LOG_SIGNING_KEY?.trim() || undefined,
    vaultId: process.env.VAULT_ID?.trim() || undefined,
  });
}
