import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { Store, Fault, type Actor } from "./store.js";
import { credentials, dataDir } from "./config.js";
import { acquireLock } from "./lock.js";
const idSchema = z.coerce.number().int().positive();
const cursorSchema = z.coerce.number().int().nonnegative().default(0);
export function createApp(store: Store, tokens: Record<Actor, string>) {
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  const timer = setInterval(() => store.tick(), 500);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      return reply.code(403).send({ error: "仅允许本机访问" });
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return reply.code(403).send({ error: "不允许跨来源请求" });
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, req, reply) => {
    const status =
      error instanceof Fault
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : ((error as any).statusCode ?? 500);
    reply.code(status).send({
      error: status === 500 ? "服务内部错误" : (error as Error).message,
    });
  });
  function actor(req: any): Actor {
    const token = String(req.headers.authorization ?? "").replace(
      /^Bearer /,
      "",
    );
    const identity = (Object.keys(tokens) as Actor[]).find(
      (a) => tokens[a] === token,
    );
    if (!identity) throw new Fault(401, "连接凭据无效");
    return identity;
  }
  function user(req: any) {
    if (actor(req) !== "user") throw new Fault(403, "仅用户可以操作");
  }
  app.get("/", async (_, reply) =>
    reply
      .type("text/html")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      )
      .send(readFileSync(resolve("public/index.html"))),
  );
  app.get("/favicon.ico", async (_, reply) => reply.code(204).send());
  for (const [url, file, type] of [
    ["/app.js", "app.js", "application/javascript"],
    ["/style.css", "style.css", "text/css"],
  ])
    app.get(url, async (_, reply) =>
      reply.type(type).send(readFileSync(resolve("public", file))),
    );
  // A custom header plus strict Origin/Host checks prevents a foreign website from obtaining the local UI token.
  app.get("/api/bootstrap", async (req) => {
    if (req.headers["x-agentgroups-ui"] !== "1")
      throw new Fault(403, "需要页面请求头");
    return { token: tokens.user };
  });
  app.get("/api/discussions", async (req) => {
    user(req);
    store.tick();
    return store.history();
  });
  app.post("/api/discussions", async (req) => {
    user(req);
    const b = z
      .object({ topic: z.string().trim().min(1).max(500) })
      .strict()
      .parse(req.body);
    return store.start(b.topic);
  });
  app.post("/api/discussions/:id/stop", async (req) => {
    user(req);
    return store.stop(idSchema.parse((req.params as any).id));
  });
  app.get("/api/room", async (req) => {
    const a = actor(req);
    const q = req.query as any;
    const id = q.discussion_id
      ? idSchema.parse(q.discussion_id)
      : store.latest()?.id;
    if (!id)
      return {
        discussion: null,
        identity: a,
        members: ["qoder", "workbuddy", "opencode", "user"],
      };
    return store.info(id, a);
  });
  app.get("/api/messages", async (req) => {
    const a = actor(req);
    const q = req.query as any;
    return store.read(
      idSchema.parse(q.discussion_id),
      a,
      cursorSchema.parse(q.after_id),
    );
  });
  app.get("/api/wait", async (req) => {
    const a = actor(req);
    const q = req.query as any;
    return store.wait(
      idSchema.parse(q.discussion_id),
      a,
      cursorSchema.parse(q.after_id),
      z.coerce.number().min(0).max(25).default(20).parse(q.timeout),
    );
  });
  app.post("/api/messages", async (req) => {
    const a = actor(req);
    const b = z
      .object({
        discussion_id: idSchema,
        content: z.string().trim().max(16000),
        reply_to: idSchema.optional(),
        request_id: z.string().min(1).max(128),
        round: z.number().int().min(1).max(3).optional(),
        skip: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    if (!b.skip && !b.content) throw new Fault(400, "消息不能为空");
    if (a === "user" && b.skip) throw new Fault(400, "用户不参与轮次跳过");
    return store.send(b.discussion_id, a, b);
  });
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const tokens = credentials();
  const release = acquireLock(dataDir);
  process.once("exit", release);
  const store = new Store(resolve(dataDir, "chat.sqlite"));
  const app = createApp(store, tokens);
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env.PORT ?? 4318);
  await app.listen({ host: "127.0.0.1", port });
  console.log(`agentgroups: http://127.0.0.1:${port}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void app.close().then(() => {
        store.close();
        process.exit(0);
      });
    });
}
