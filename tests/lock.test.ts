import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../src/lock.js";

test("second backend cannot open the same data directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentgroups-lock-"));
  try {
    const release = acquireLock(dir);
    assert.throws(() => acquireLock(dir), /已被后台进程/);
    release();
    acquireLock(dir)();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
