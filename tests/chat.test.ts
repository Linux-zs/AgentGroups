import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, agents } from "../src/store.js";
import { createApp } from "../src/server.js";
import { DatabaseSync } from 'node:sqlite';
const tokens = {
  qoder: "test-q",
  workbuddy: "test-w",
  opencode: "test-o",
  user: "test-u",
};
function start(s: Store, topic: string, max = 0) {
  const d = s.start(topic, max);
  for (const a of agents) s.info(d.id, a);
  return s.begin(d.id);
}
function send(content: string, round = 1) {
  return { content, round, request_id: crypto.randomUUID() };
}
test('HTTP creation waits for readiness; only the user can begin; invalid member choices are rejected', async () => {
  const s = new Store(':memory:');
  const app = createApp(s, tokens);
  const request = (actor: keyof typeof tokens, url: string, payload: any) => app.inject({ method: 'POST', url, headers: { host: 'localhost', authorization: `Bearer ${tokens[actor]}` }, payload });
  try {
    assert.equal((await request('user', '/api/discussions', { topic: 'x', participants: ['qoder', 'qoder'] })).statusCode, 400);
    const created = await request('user', '/api/discussions', { topic: 'x', participants: ['qoder', 'workbuddy'], max_rounds: 20 });
    assert.equal(created.statusCode, 200);
    const d = created.json();
    assert.equal(d.status, 'waiting');
    assert.equal(d.max_rounds, 20);
    assert.equal((await request('user', `/api/discussions/${d.id}/begin`, {})).statusCode, 409);
    for (const a of ['qoder', 'workbuddy'] as const) await app.inject({ url: '/api/room', headers: { host: 'localhost', authorization: `Bearer ${tokens[a]}` } });
    assert.equal((await request('qoder', `/api/discussions/${d.id}/begin`, {})).statusCode, 403);
    assert.equal((await request('user', `/api/discussions/${d.id}/begin`, {})).json().round, 1);
  } finally { await app.close(); s.close(); }
});
test('old schema migrates without losing history and waiting rooms interrupt on restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentgroups-migrate-'));
  const path = join(dir, 'old.sqlite');
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE discussions(id INTEGER PRIMARY KEY, topic TEXT NOT NULL, status TEXT NOT NULL, round INTEGER NOT NULL, deadline INTEGER NOT NULL, created_at INTEGER NOT NULL); INSERT INTO discussions VALUES(1,'legacy','completed',3,100,0)");
  old.close();
  let s = new Store(path);
  try {
    assert.equal(s.get(1).topic, 'legacy');
    assert.equal(s.get(1).max_rounds, 3);
    assert.deepEqual(s.get(1).participants, [...agents]);
    const d = s.start('new');
    s.close(); s = new Store(path);
    assert.equal(s.get(d.id).status, 'interrupted');
    assert.equal(s.get(d.id).max_rounds, 0);
  } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("shared identities, concurrent ordering, validation and authorization through HTTP", async () => {
  const s = new Store(":memory:");
  const app = createApp(s, tokens);
  const d = start(s, "test fixture");
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
    const d = start(s, "test", 3);
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
    for (const round of [2, 3]) {
      for (const a of agents) {
        const messages = s.read(d.id, a, 0).messages;
        const previous = messages.find(m => m.round === round - 1 && m.sender !== a && m.kind === 'message');
        s.send(d.id, a, { ...send('response', round), reply_to: previous?.id });
      }
    }
    assert.equal(s.get(d.id).status, "completed");
    assert.equal(s.read(d.id, "qoder", 0).messages.length, 9);
    assert.equal(s.read(d.id, "qoder", first.id).messages.length, 8);
    assert.equal(s.read(d.id, "qoder", 0).messages.length, 9);
    assert.throws(() => s.send(d.id, "user", send("late")), /已结束/);
    const next = start(s, "next");
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
    const d = start(s, "wait");
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
    s.send(d.id, "workbuddy", { ...send(""), skip: true });
    s.send(d.id, "opencode", { ...send(""), skip: true });
    assert.equal((await pending).discussion.round, 2);
    pending = s.wait(d.id, "qoder", s.read(d.id, "qoder", 0).next_cursor, 1);
    s.stop(d.id);
    assert.equal((await pending).discussion.status, "stopped");
    assert.throws(() => s.send(d.id, "opencode", send("late", 2)), /已结束/);
  } finally {
    s.close();
  }
});
test('slow members retain their turn; unread or unrelated replies cannot advance conversation', () => {
  let now = 0;
  const s = new Store(':memory:', 100, () => now);
  try {
    const d = start(s, 'slow');
    const q = s.send(d.id, 'qoder', send('q'));
    now = 100000;
    s.tick();
    assert.equal(s.get(d.id).round, 1);
    assert.equal(s.info(d.id, 'user').turns.length, 1);
    assert.throws(() => s.send(d.id, 'qoder', send('run ahead', 2)), /轮次/);
    const w = s.send(d.id, 'workbuddy', send('slow opinion'));
    s.send(d.id, 'opencode', { ...send(''), skip: true });
    assert.equal(s.get(d.id).round, 2);
    s.read(d.id, 'qoder', 99999);
    assert.throws(() => s.send(d.id, 'qoder', { ...send('reply', 2), reply_to: w.id }), /读完/);
    s.read(d.id, 'qoder', 0);
    assert.throws(() => s.send(d.id, 'qoder', { ...send('monologue', 2), reply_to: q.id }), /引用/);
    s.send(d.id, 'qoder', { ...send('respond to workbuddy', 2), reply_to: w.id });
    for (let round = 2; round <= 5; round++) {
      for (const a of agents) {
        if (round === 2 && a === 'qoder') continue;
        s.read(d.id, a, 0);
        s.send(d.id, a, { ...send('', round), skip: true });
      }
    }
    assert.equal(s.get(d.id).round, 6);
    assert.equal(s.get(d.id).status, 'active');
  } finally { s.close(); }
});
test('preparation requires tool identity confirmation and supports two participants', async () => {
  const s = new Store(':memory:');
  try {
    const d = s.start('ready', 1, ['qoder', 'workbuddy']);
    assert.equal(d.status, 'waiting');
    assert.throws(() => s.begin(d.id), /就绪/);
    assert.throws(() => s.send(d.id, 'qoder', send('early')), /准备/);
    s.info(d.id, 'user');
    s.info(d.id, 'opencode');
    s.info(d.id, 'qoder');
    assert.throws(() => s.begin(d.id), /就绪/);
    s.info(d.id, 'workbuddy');
    const wait = s.wait(d.id, 'qoder', 0, 1);
    s.begin(d.id);
    assert.equal((await wait).discussion.status, 'active');
    assert.throws(() => s.send(d.id, 'opencode', send('excluded')), /未被选/);
    s.send(d.id, 'qoder', send('q'));
    s.send(d.id, 'workbuddy', send('w'));
    assert.equal(s.get(d.id).status, 'completed');
  } finally { s.close(); }
});
test("restart preserves messages and cursor, interrupts activity", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentgroups-"));
  const path = join(dir, "chat.sqlite");
  let s = new Store(path);
  try {
    const d = start(s, "persistent");
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
    assert.notEqual(start(s, "new").id, d.id);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
