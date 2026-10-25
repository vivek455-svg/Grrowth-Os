import { existsSync } from "node:fs";

/** Loads .env.local (then .env) for CLI scripts, like Next.js does for the app. Existing env vars win. */
export function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
}
