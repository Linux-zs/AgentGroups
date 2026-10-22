const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const names: Record<string, string> = {
  qoder: "Qoder",
  workbuddy: "WorkBuddy",
  opencode: "OpenCode",
  user: "用户",
};
const statuses: Record<string, string> = {
  waiting: "等待成员就绪",
  active: "讨论进行中",
  stopped: "已停止",
  completed: "已完成",
  interrupted: "服务重启 · 已中断",
};
let token = "",
  selected = 0,
  cursor = 0,
  replyTo: number | undefined,
  busy = false,
  refreshing = false,
  active = false,
  waiting = false,
  canBegin = false;
let pendingSend:
  { content: string; reply_to?: number; request_id: string } | undefined;
async function api(path: string, body?: unknown) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
function error(e: unknown) {
  $("error").hidden = false;
  $("error").textContent = (e as Error).message;
}
function setReply(id?: number) {
  replyTo = id;
  $("reply").replaceChildren();
  $("reply").hidden = !id;
  if (id) {
    $("reply").append(`回复 #${id}`);
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "取消";
    b.onclick = () => setReply();
    $("reply").append(b);
  }
}
function members(progress: any[] = [], turns: any[] = [], round = 0, participants: string[] = [], ready: string[] = []) {
  $("members").replaceChildren();
  for (const [id, name] of Object.entries(names)) {
    const el = document.createElement("div");
    el.className = "member";
    const avatar = document.createElement("div");
    avatar.className = `avatar ${id}`;
    avatar.textContent = name.slice(0, 1);
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = name;
    const sub = document.createElement("small");
    const p = progress.find((x) => x.sender === id);
    const t = turns.find((x) => x.sender === id && x.round === round);
    const participating = participants.includes(id);
    const stale = p && Date.now() - p.last_active > 90000;
    const label = id === 'user' ? '网页用户' : !participating ? (selected ? '未参与本次讨论' : '尚未创建讨论') : !p ? '尚未调用工具' : !active && !waiting ? '讨论已结束' : stale ? '长时间无活动 · 请检查客户端' : waiting ? (ready.includes(id) ? '已确认就绪' : '已连接 · 待 room_info 确认') : t ? ({ message: '本轮已发言', skip: '本轮已跳过', timeout: '旧版超时记录' }[t.outcome as string] ?? t.outcome) : '已连接 · 等待本轮发言';
    sub.textContent = label + (p ? ' · 最近活动 ' + new Date(p.last_active).toLocaleTimeString() : '');
    el.classList.toggle('member-stale', Boolean(stale && participating));
    info.append(title, sub);
    el.append(avatar, info);
    $("members").append(el);
  }
}
function append(messages: any[]) {
  if (!messages.length) return;
  if (cursor === 0) $("messages").replaceChildren();
  const box = $("messages");
  const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  for (const m of messages) {
    if (document.getElementById(`message-${m.id}`)) continue;
    const row = document.createElement("div");
    row.className = "message";
    row.id = `message-${m.id}`;
    const avatar = document.createElement("div");
    avatar.className = `avatar ${m.sender}`;
    avatar.textContent = (names[m.sender] ?? m.sender).slice(0, 1);
    const body = document.createElement("div");
    body.className = "message-body";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const name = document.createElement("strong");
    name.textContent = names[m.sender] ?? m.sender;
    const time = document.createElement("span");
    time.textContent = `#${m.id} · 第 ${m.round} 轮 · ${new Date(m.created_at).toLocaleTimeString()}`;
    meta.append(name, time);
    body.append(meta);
    if (m.reply_to) {
      const a = document.createElement("a");
      a.href = `#message-${m.reply_to}`;
      a.textContent = `↳ 回复 #${m.reply_to}`;
      body.append(a);
    }
    const p = document.createElement("p");
    p.textContent = m.kind === "skip" ? `[跳过] ${m.content}` : m.content;
    const b = document.createElement("button");
    b.className = "reply-button";
    b.type = "button";
    b.textContent = "回复";
    b.onclick = () => {
      setReply(m.id);
      $("content").focus();
    };
    body.append(p, b);
    row.append(avatar, body);
    box.append(row);
  }
  if (bottom) box.scrollTop = box.scrollHeight;
}
function select(id: number) {
  selected = id;
  active = false;
  waiting = false;
  canBegin = false;
  controls();
  cursor = 0;
  pendingSend = undefined;
  setReply();
  $("messages").replaceChildren();
  const el = document.createElement("div");
  el.className = "empty";
  el.textContent = "还没有发言。请在选定客户端启动入群任务。";
  $("messages").append(el);
}
function controls() {
  ($("history") as HTMLSelectElement).disabled = busy;
  ($("send") as HTMLButtonElement).disabled = !active || busy;
  ($("content") as HTMLTextAreaElement).disabled = !active;
  ($("stop") as HTMLButtonElement).disabled = !(active || waiting) || busy;
  ($("begin") as HTMLButtonElement).disabled = !canBegin || busy;
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const history = await api("/api/discussions");
    const selectEl = $<HTMLSelectElement>("history");
    selectEl.replaceChildren();
    if (!history.length) {
      selectEl.add(new Option("暂无讨论", ""));
    }
    for (const d of history)
      selectEl.add(new Option(`#${d.id} ${d.topic}`, String(d.id)));
    if (!selected && history.length) select(history[0].id);
    selectEl.value = String(selected || "");
    ($("start") as HTMLButtonElement).disabled =
      history.some((d: any) => ["active", "waiting"].includes(d.status)) || busy;
    if (selected) {
      const id = selected;
      const info = await api(`/api/room?discussion_id=${id}`);
      if (id !== selected) return;
      const d = info.discussion;
      active = d.status === "active";
      waiting = d.status === "waiting";
      canBegin = waiting && d.participants.every((a: string) => info.ready.includes(a));
      $("topic-title").textContent = d.topic;
      $("status").textContent = statuses[d.status] ?? d.status;
      members(info.progress, info.turns, d.round, d.participants, info.ready);
      $("preparation").hidden = !waiting;
      const absent = d.participants.filter((a: string) => !info.ready.includes(a));
      $("ready-summary").textContent = canBegin ? '所有选定成员已确认就绪，可以开始。' : '等待确认就绪：' + absent.map((a: string) => names[a]).join('、');
      $("rounds").textContent = d.round ? '第 ' + d.round + ' 轮 / ' + (d.max_rounds || '不限轮次') : '准备阶段 · 尚未开始计时';
      const pending = info.waiting_for.map((a: string) => names[a]).join('、');
      $("deadline").textContent = active
        ? (Date.now() > d.deadline ? '等待已超过 3 分钟，仍保留本轮。' : '本轮等齐后才推进。') + ' 等待：' + (pending || '正在推进')
        : waiting ? '请在客户端调用 room_info 确认就绪，然后点击开始。' : '本次讨论已结束，记录已保存。';
      let more = true;
      while (more) {
        const r = await api(
          `/api/messages?discussion_id=${id}&after_id=${cursor}`,
        );
        if (id !== selected) return;
        append(r.messages);
        cursor = r.next_cursor;
        more = r.has_more;
      }
    }
    controls();
    $("connection").textContent = "已连接 · 每 2 秒同步";
    $("connection").className = "";
  } catch (e) {
    $("connection").textContent = "连接异常 · 保留现有记录，正在重试";
    $("connection").className = "offline";
  } finally {
    refreshing = false;
  }
}
async function action(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  controls();
  $("error").hidden = true;
  try {
    await fn();
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    await refresh();
    controls();
  }
}
$("start-form").onsubmit = (e) => {
  e.preventDefault();
  void action(async () => {
    const d = await api("/api/discussions", {
      topic: $<HTMLInputElement>("topic").value,
      max_rounds: Number($<HTMLSelectElement>("max-rounds").value),
      participants: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="participant"]:checked')).map(el => el.value),
    });
    select(d.id);
    $<HTMLInputElement>("topic").value = "";
  });
};
$("send-form").onsubmit = (e) => {
  e.preventDefault();
  void action(async () => {
    const content = $<HTMLTextAreaElement>("content").value.trim();
    if (!content) throw new Error("请填写消息");
    if (
      !pendingSend ||
      pendingSend.content !== content ||
      pendingSend.reply_to !== replyTo
    )
      pendingSend = {
        content,
        reply_to: replyTo,
        request_id: crypto.randomUUID(),
      };
    await api("/api/messages", { discussion_id: selected, ...pendingSend });
    pendingSend = undefined;
    if ($<HTMLTextAreaElement>("content").value.trim() === content)
      $<HTMLTextAreaElement>("content").value = "";
    setReply();
  });
};
$("begin").onclick = () => void action(async () => { await api(`/api/discussions/${selected}/begin`, {}); });
$("stop").onclick = () =>
  void action(async () => {
    await api(`/api/discussions/${selected}/stop`, {});
  });
$("history").onchange = () => {
  select(Number($<HTMLSelectElement>("history").value));
  void refresh();
};
members();
async function boot() {
  try {
    const r = await fetch("/api/bootstrap", {
      headers: { "X-Agentgroups-UI": "1" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error("无法连接本机服务");
    token = (await r.json()).token;
    await refresh();
    setInterval(() => void refresh(), 2000);
  } catch (e) {
    error(e);
    $("connection").textContent = "连接异常 · 正在重试";
    setTimeout(() => void boot(), 2000);
  }
}
void boot();
