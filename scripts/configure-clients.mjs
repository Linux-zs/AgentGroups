import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse, modify, applyEdits } from 'jsonc-parser';

export function configureClients(root, home = homedir()) {
  const backup = resolve(root, '.local/config-backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const targets = [
    ['qoder', resolve(home, '.qoder/settings.json'), 'mcpServers'],
    ['workbuddy', resolve(home, '.workbuddy/mcp.json'), 'mcpServers'],
    ['opencode', resolve(home, '.config/opencode/opencode.json'), 'mcp'],
  ];
  // Validate every file before writing any client configuration.
  const plans = targets.map(([name, defaultPath, key]) => {
    const path = name === 'opencode' && existsSync(defaultPath + 'c') ? defaultPath + 'c' : defaultPath;
    if (name === 'opencode' && existsSync(defaultPath) && existsSync(defaultPath + 'c'))
      throw new Error('OpenCode 同时存在 JSON 和 JSONC 配置，请先确认使用哪份文件。');
    const original = existsSync(path) ? readFileSync(path, 'utf8') : '{}\n';
    const errors = [];
    const parsed = parse(original.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true });
    if (errors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        (parsed[key] !== undefined && (!parsed[key] || typeof parsed[key] !== 'object' || Array.isArray(parsed[key]))))
      throw new Error(`配置格式错误，未修改：${path}`);
    const entry = JSON.parse(readFileSync(resolve(root, '.local/clients', name + '.json'), 'utf8'))[key].agentgroups;
    if (name !== 'opencode') entry.type = 'stdio';
    const text = original.replace(/^\uFEFF/, '');
    return { name, path, original, updated: applyEdits(text, modify(text, [key, 'agentgroups'], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } })) };
  });
  for (const plan of plans) {
    if (plan.original === plan.updated) continue;
    mkdirSync(backup, { recursive: true });
    if (existsSync(plan.path)) copyFileSync(plan.path, resolve(backup, plan.name + '.json'));
    mkdirSync(dirname(plan.path), { recursive: true });
    writeFileSync(plan.path, plan.updated, { mode: 0o600 });
    console.log(`已配置 ${plan.name}：${plan.path}`);
  }
  return plans.map(p => p.path);
}
