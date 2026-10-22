import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  rmdirSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";

// Acquire before SQLite: a second launch must not mark a live room interrupted.
export function acquireLock(directory: string) {
  const lock = resolve(directory, "server.lock");
  const owner = resolve(lock, "pid");
  if (existsSync(lock)) {
    let pid: number;
    try {
      pid = Number(readFileSync(owner, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error();
    } catch {
      throw new Error(`锁文件不完整，请确认后台已关闭后移除 ${lock}`);
    }
    try {
      process.kill(pid, 0);
      throw new Error(`数据目录已被后台进程 ${pid} 使用`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
      rmSync(owner);
      rmdirSync(lock);
    }
  }
  mkdirSync(lock);
  writeFileSync(owner, String(process.pid), { flag: "wx" });
  return () => {
    if (readFileSync(owner, "utf8") === String(process.pid)) {
      rmSync(owner);
      rmdirSync(lock);
    }
  };
}
