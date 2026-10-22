import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('installer preserves JSONC comments and existing services; refuses invalid files before writes', async () => {
  // @ts-ignore JavaScript installer module
  const { configureClients } = await import('../scripts/configure-clients.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agentgroups-install-'));
  const home = join(root, 'home');
  mkdirSync(join(root, '.local/clients'), { recursive: true });
  for (const name of ['qoder', 'workbuddy', 'opencode']) {
    const key = name === 'opencode' ? 'mcp' : 'mcpServers';
    writeFileSync(join(root, '.local/clients', name + '.json'), JSON.stringify({ [key]: { agentgroups: { command: 'test-node' } } }));
  }
  mkdirSync(join(home, '.config/opencode'), { recursive: true });
  const target = join(home, '.config/opencode/opencode.jsonc');
  writeFileSync(target, '{ // keep my comment\n "mcp": { "existing": {"enabled": true}, },\n}');
  configureClients(root, home);
  const first = readFileSync(target, 'utf8');
  assert.match(first, /keep my comment/);
  assert.match(first, /existing/);
  assert.match(first, /agentgroups/);
  configureClients(root, home);
  assert.equal(readFileSync(target, 'utf8'), first);
  const qoder = join(home, '.qoder/settings.json');
  const before = readFileSync(qoder, 'utf8');
  writeFileSync(target, 'broken json');
  assert.throws(() => configureClients(root, home), /配置格式错误/);
  assert.equal(readFileSync(qoder, 'utf8'), before);
  assert.ok(existsSync(join(root, '.local/config-backups')));
});
