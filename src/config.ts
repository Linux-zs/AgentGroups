import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { agents, type Actor } from "./store.js";
export const dataDir = resolve(process.env.AGENTGROUPS_DATA_DIR ?? ".local");
export function credentials(): Record<Actor, string> {
  mkdirSync(dataDir, { recursive: true });
  const file = resolve(dataDir, "credentials.json");
  if (!existsSync(file))
    writeFileSync(
      file,
      JSON.stringify(
        Object.fromEntries(
          [...agents, "user"].map((a) => [a, randomBytes(32).toString("hex")]),
        ),
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
  return JSON.parse(readFileSync(file, "utf8"));
}
