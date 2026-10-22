import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, agents } from "../src/store.js";
import { createApp } from "../src/server.js";
const tokens = {
  qoder: "test-q",
  workbuddy: "test-w",
  opencode: "test-o",
  user: "test-u",
};
function send(content: string, round = 1) {
  return { content, round, request_id: crypto.randomUUID() };
}
test("shared identities, concurrent ordering, validation and authorization through HTTP", async () => {
  const s = new Store(":memory:");
  const app = createApp(s, tokens);
  const d = s.start("test fixture");
  try {
    const request = (token: string, payload: any) =>
      app.inject({
        method: "POST",
        url: "/api/messages",
        headers: { host: "127.0.0.1", authorization: `Bearer ${token}` },
        payload,
      });
    assert.equal(
      (await request("wrong", { discussion_id: d.id, ...send("x") }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await request(tokens.qoder, {
          discussion_id: d.id,
          ...send("x"),
          sender: "opencode",
        })
      ).statusCode,
      400,
    );
    const results = await Promise.all(
      agents.map((a) =>
        request(tokens[a], { discussion_id: d.id, ...send(a) }),
      ),
    );
    assert.deepEqual(
      results.map((r) => r.statusCode),
      [200, 200, 200],
    );
    const messages = results.map((r) => r.json());
    assert.equal(new Set(messages.map((m) => m.id)).size, 3);
    for (const a of agents) {
      const r = await app.inject({
        url: `/api/messages?discussion_id=${d.id}`,
        headers: { host: "localhost", authorization: `Bearer ${tokens[a]}` },
      });
      assert.equal(r.json().messages.length, 3);
      assert.deepEqual(
        r.json().messages.map((m: any) => m.sender),
        [...agents],
      );
    }
    assert.equal(s.get(d.id).round, 2);
    assert.equal(
      (
        await request(tokens.qoder, {
          discussion_id: d.id,
          ...send("stale", 1),
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await request(tokens.qoder, {
          discussion_id: d.id,
          ...send("reply", 2),
          reply_to: 999,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/discussions/${d.id}/stop`,
          headers: {
            host: "localhost",
            authorization: `Bearer ${tokens.qoder}`,
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/bootstrap",
          headers: { host: "evil.example", "x-agentgroups-ui": "1" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/bootstrap",
          headers: {
            host: "localhost",
            origin: "https://evil.example",
            "x-agentgroups-ui": "1",
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/bootstrap",
          headers: { host: "localhost" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
    s.close();
  }
});
test("idempotency, cursor reread, per-round quota and completion", () => {
  const s = new Store(":memory:");
  try {
    const d = s.start("test");
    const input = send("first");
    const first = s.send(d.id, "qoder", input);
    assert.equal(s.send(d.id, "qoder", input).id, first.id);
    assert.throws(
      () => s.send(d.id, "qoder", { ...input, content: "changed" }),
      /request_id/,
    );
    assert.throws(() => s.send(d.id, "qoder", send("second")), /已经/);
    for (const a of ["workbuddy", "opencode"] as const)
      s.send(d.id, a, { ...send("", 1), skip: true });
    for (const round of [2, 3])
      for (const a of agents)
        s.send(d.id, a, { ...send("response", round), reply_to: first.id });
    assert.equal(s.get(d.id).status, "completed");
    assert.equal(s.read(d.id, "qoder", 0).messages.length, 9);
    assert.equal(s.read(d.id, "qoder", first.id).messages.length, 8);
    assert.equal(s.read(d.id, "qoder", 0).messages.length, 9);
    assert.throws(() => s.send(d.id, "user", send("late")), /已结束/);
    const next = s.start("next");
    assert.throws(
      () => s.send(next.id, "user", { ...send("cross"), reply_to: first.id }),
      /不属于/,
    );
  } finally {
    s.close();
  }
});
test("wait responds to messages, stop, round advance and timeout", async () => {
  let now = 0;
  const s = new Store(":memory:", 100, () => now);
  try {
    const d = s.start("wait");
    let pending = s.wait(d.id, "workbuddy", 0, 1);
    s.send(d.id, "qoder", send("wake"));
    assert.equal((await pending).messages.length, 1);
    const cursor = s.read(d.id, "qoder", 0).next_cursor;
    assert.equal(
      (await s.wait(d.id, "qoder", cursor, 0.01)).messages.length,
      0,
    );
    pending = s.wait(d.id, "qoder", cursor, 1);
    now = 101;
    s.tick();
    assert.equal((await pending).discussion.round, 2);
    pending = s.wait(d.id, "qoder", cursor, 1);
    s.stop(d.id);
    assert.equal((await pending).discussion.status, "stopped");
    assert.throws(() => s.send(d.id, "opencode", send("late", 2)), /已结束/);
  } finally {
    s.close();
  }
});
test("absent members are recorded on each deadline", () => {
  let now = 0;
  const s = new Store(":memory:", 100, () => now);
  try {
    const d = s.start("absence");
    now = 301;
    s.tick();
    assert.equal(s.get(d.id).status, "completed");
    const info = s.info(d.id, "user");
    assert.equal(info.turns.length, 9);
    assert.ok(info.turns.every((t: any) => t.outcome === "timeout"));
  } finally {
    s.close();
  }
});
test("restart preserves messages and cursor, interrupts activity", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentgroups-"));
  const path = join(dir, "chat.sqlite");
  let s = new Store(path);
  try {
    const d = s.start("persistent");
    const m = s.send(d.id, "qoder", send("saved"));
    s.read(d.id, "workbuddy", 0);
    s.close();
    s = new Store(path);
    assert.equal(s.get(d.id).status, "interrupted");
    assert.equal(s.read(d.id, "user", 0).messages[0].id, m.id);
    assert.equal(
      (
        s
          .info(d.id, "user")
          .progress.find((p: any) => p.sender === "workbuddy") as any
      ).cursor,
      m.id,
    );
    assert.throws(() => s.send(d.id, "qoder", send("old")), /已结束/);
    assert.notEqual(s.start("new").id, d.id);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
