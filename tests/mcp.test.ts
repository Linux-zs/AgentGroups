import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Store } from "../src/store.js";
import { createApp } from "../src/server.js";
test("actual SDK stdio bridges share backend and stay bound to original discussion", async () => {
  const s = new Store(":memory:");
  const tokens = {
    qoder: "fixture-q",
    workbuddy: "fixture-w",
    opencode: "fixture-o",
    user: "fixture-u",
  };
  const app = createApp(s, tokens);
  const clients: Client[] = [];
  try {
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const d = s.start(
      "automated transport fixture, not real client acceptance",
    );
    for (const a of ["qoder", "workbuddy", "opencode"] as const) {
      const c = new Client({ name: `test-${a}`, version: "1.0" });
      await c.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ["--import", "tsx", resolve("src/mcp.ts")],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string",
              ),
            ),
            AGENTGROUPS_URL: url,
            AGENTGROUPS_TOKEN: tokens[a],
          },
          stderr: "pipe",
        }),
      );
      clients.push(c);
      const tools = await c.listTools();
      assert.equal(tools.tools.length, 4);
      const info = await c.callTool({ name: "room_info", arguments: {} });
      assert.equal(JSON.parse((info.content as any)[0].text).identity, a);
    }
    const sent = await clients[0].callTool({
      name: "send_message",
      arguments: { content: "transport fixture", round: 1, request_id: "same" },
    });
    assert.ok(!sent.isError);
    const m = JSON.parse((sent.content as any)[0].text);
    for (const c of clients.slice(1)) {
      const read = await c.callTool({
        name: "read_messages",
        arguments: { after_id: 0 },
      });
      assert.equal(
        JSON.parse((read.content as any)[0].text).messages[0].id,
        m.id,
      );
    }
    const waiting = clients[1].callTool({
      name: "wait_messages",
      arguments: { after_id: m.id, timeout: 2 },
    });
    setTimeout(() => s.stop(d.id), 30);
    const stopped = await waiting;
    assert.equal(
      JSON.parse((stopped.content as any)[0].text).discussion.status,
      "stopped",
    );
    s.start("new discussion");
    const info = await clients[0].callTool({
      name: "room_info",
      arguments: {},
    });
    assert.equal(JSON.parse((info.content as any)[0].text).discussion.id, d.id);
    const late = await clients[0].callTool({
      name: "send_message",
      arguments: { content: "late", round: 1, request_id: "late" },
    });
    assert.equal(late.isError, true);
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
    s.close();
  }
});
