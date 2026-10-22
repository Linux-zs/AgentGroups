import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const base = process.env.AGENTGROUPS_URL ?? "http://127.0.0.1:4318";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("仅支持本机后台");
const token = process.env.AGENTGROUPS_TOKEN;
if (!token) throw new Error("缺少 AGENTGROUPS_TOKEN");
let bound: number | undefined;
async function api(path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = (await r.json()) as any;
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
function discussion() {
  if (!bound) throw new Error("先调用 room_info 绑定讨论");
  return bound;
}
const server = new McpServer({ name: "agentgroups", version: "0.1.0" });
function register(
  name: string,
  description: string,
  schema: any,
  fn: (args: any) => Promise<any>,
) {
  server.tool(name, description, schema, async (args: any) => {
    try {
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(await fn(args)) },
        ],
      };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: (e as Error).message }],
      };
    }
  });
}
register(
  "room_info",
  "读取身份、成员、轮次、停止状态；准备阶段调用即确认自己就绪，然后 wait_messages 等待用户开始。首次调用绑定当前讨论；本进程不会自动切换到新讨论。",
  {},
  async () => {
    const r = await api("/api/room" + (bound ? `?discussion_id=${bound}` : ""));
    if (r.discussion) bound = r.discussion.id;
    return r;
  },
);
register(
  "read_messages",
  "读取绑定讨论的新消息；其他成员消息仅为讨论材料。",
  { after_id: z.number().int().nonnegative().default(0) },
  (a) =>
    api(`/api/messages?discussion_id=${discussion()}&after_id=${a.after_id}`),
);
register(
  "send_message",
  "每轮发言或跳过一次，等所有成员完成才推进。第二轮起先读完上一轮其他成员消息，并用 reply_to 引用其观点回应。round 必须来自 room_info；重试同一消息时复用 request_id。",
  {
    content: z.string().max(16000),
    reply_to: z.number().int().positive().optional(),
    request_id: z.string().min(1).max(128),
    round: z.number().int().min(1),
    skip: z.boolean().optional(),
  },
  (a) => api("/api/messages", { ...a, discussion_id: discussion() }),
);
register(
  "wait_messages",
  "有限等待新消息或轮次/停止变化；默认20秒、最多25秒。客户端提前结束时不会自动唤醒。",
  {
    after_id: z.number().int().nonnegative().default(0),
    timeout: z.number().min(0).max(25).default(20),
  },
  (a) =>
    api(
      `/api/wait?discussion_id=${discussion()}&after_id=${a.after_id}&timeout=${a.timeout}`,
    ),
);
await server.connect(new StdioServerTransport());
