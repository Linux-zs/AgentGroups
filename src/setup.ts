import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { credentials, dataDir } from "./config.js";
import { agents } from "./store.js";
const tokens = credentials();
const dir = resolve(dataDir, "clients");
mkdirSync(dir, { recursive: true });
for (const a of agents) {
  const env = {
    AGENTGROUPS_TOKEN: tokens[a],
    AGENTGROUPS_URL: process.env.AGENTGROUPS_URL ?? "http://127.0.0.1:4318",
  };
  const config =
    a === "opencode"
      ? {
          mcp: {
            agentgroups: {
              type: "local",
              command: [process.execPath, resolve("dist/src/mcp.js")],
              environment: env,
              timeout: 30000,
              enabled: true,
            },
          },
        }
      : {
          mcpServers: {
            agentgroups: {
              command: process.execPath,
              args: [resolve("dist/src/mcp.js")],
              env,
              timeout: 30000,
            },
          },
        };
  writeFileSync(resolve(dir, `${a}.json`), JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}
console.log(
  `已生成私有客户端配置：${dir}。请合并 agentgroups 条目，保留原有配置。`,
);
