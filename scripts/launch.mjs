import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
// The portable entry always uses this installation's local data and port.
process.env.AGENTGROUPS_DATA_DIR = resolve(root, '.local');
process.env.PORT = '4318';
process.env.AGENTGROUPS_URL = 'http://127.0.0.1:4318';
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) throw new Error('安装或构建失败，请查看上方错误后重试。');
};
try {
  // Never send credentials to an unrelated listener on the chosen port.
  const occupied = await new Promise((done, reject) => {
    const probe = createServer();
    probe.once('error', e => e.code === 'EADDRINUSE' ? done(true) : reject(e));
    probe.listen(4318, '127.0.0.1', () => probe.close(() => done(false)));
  });
  if (occupied) {
    const response = await fetch('http://127.0.0.1:4318/api/bootstrap', { headers: { 'X-Agentgroups-UI': '1' }, signal: AbortSignal.timeout(3000) });
    const data = await response.json();
    const local = JSON.parse(readFileSync('.local/credentials.json', 'utf8'));
    if (!response.ok || data.token !== local.user) throw new Error('4318 端口已被其他服务占用，请关闭该服务后重试。');
    console.log('群聊服务已运行。');
  } else {
    run([resolve(process.execPath, '../node_modules/npm/bin/npx-cli.js'), '--yes', 'pnpm@11.25.0', 'install', '--frozen-lockfile']);
    run(['node_modules/typescript/bin/tsc']);
    run(['node_modules/esbuild/bin/esbuild', 'web/app.ts', '--bundle', '--outfile=public/app.js']);
  }
  run(['dist/src/setup.js']);
  const { configureClients } = await import('./configure-clients.mjs');
  configureClients(root);
  if (!occupied) {
    const { openSync } = await import('node:fs');
    mkdirSync('.local', { recursive: true });
    const child = spawn(process.execPath, ['dist/src/server.js'], { cwd: root, env: process.env, detached: true, windowsHide: true,
      stdio: ['ignore', openSync('.local/server.stdout.log', 'a'), openSync('.local/server.stderr.log', 'a')] });
    child.unref();
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch('http://127.0.0.1:4318/api/bootstrap', { headers: { 'X-Agentgroups-UI': '1' }, signal: AbortSignal.timeout(1000) });
        const data = await r.json();
        if (r.ok && data.token === JSON.parse(readFileSync('.local/credentials.json', 'utf8')).user) { ready = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    if (!ready) throw new Error('后台启动失败，请查看 .local/server.stderr.log。');
  }
  spawn('explorer.exe', ['http://127.0.0.1:4318'], { windowsHide: true, stdio: 'ignore' }).unref();
  console.log('\n配置完成。重启三个客户端；WorkBuddy 中批准/信任 agentgroups。');
  console.log('在网页创建话题，再将 docs/prompts 中对应入群提示发送到三个客户端。');
  console.log('工具配置成功不代表三个桌面会话已经入群。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
