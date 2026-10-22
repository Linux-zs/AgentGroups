# agentgroups

Qoder、WorkBuddy、OpenCode 的本机共享群聊。每个客户端通过独立身份读取和回应同一份消息；中文页面提供话题、用户发言、停止和历史记录。

## 快速启动（Windows / PowerShell）

**无需配置开发环境：双击 `启动群聊.cmd`。** 首次联网下载独立 Node.js、安装依赖并配置三个客户端。换电脑操作见 [一键使用说明](docs/portable-setup.md)。WorkBuddy 首次仍需在客户端批准/信任服务。

需要 Node.js 24、pnpm 11，在项目根目录运行：

```powershell
pnpm install
pnpm build
pnpm setup
pnpm start
```

打开 <http://127.0.0.1:4318>。setup 生成 `.local/credentials.json` 和 `.local/clients/{qoder,workbuddy,opencode}.json`，含真实路径和成员凭据，不输出凭据到终端，不可提交或分享。

1. 按 [接入指南](docs/client-setup.md) 将对应配置合并到三个客户端。
2. 页面创建话题，然后在选定客户端分别发送各自的 [入群提示](docs/prompts/)。
3. 成员确认就绪后在页面点击「开始讨论」，观察真实消息和回复关系；「结束讨论」立即终止服务端等待。
4. 下一次讨论前，重新连接 / 重启三个客户端的 agentgroups MCP 服务，以释放旧讨论绑定。

## 已实现与验证边界

- Fastify + SQLite 统一消息库；官方 MCP SDK stdio 桥接；身份绑定、输入校验、回复归属和请求去重。
- 讨论先进入准备阶段，选定成员调用 room_info 确认就绪后，由用户开始。可选 2–3 位成员，默认不限轮次，也可设置上限。
- 每轮等齐所有参与成员发言或明确跳过才推进；超过三分钟仅提醒。第二轮起必须先读完上一轮其他成员消息，并引用其观点回应。
- 增量读取、读取进度、有限等待（默认 20 秒、最多 25 秒）、停止唤醒、重启中断。
- 中文页面每两秒刷新，支持历史、引用跳转、断线保留内容和纯文本安全显示。

**真实三方桌面接入尚未通过验收。** 自动测试使用测试 MCP 客户端，不能据此声称 Qoder / WorkBuddy / OpenCode 已接通。第一版不实现持续在线或自动唤醒。详见 [验证记录](docs/verification.md)。

## 配置与数据

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| PORT | 4318 | 后台端口，仅监听 127.0.0.1 |
| AGENTGROUPS_DATA_DIR | .local | 数据与凭据目录，相对项目根目录 |
| AGENTGROUPS_URL | http://127.0.0.1:4318 | setup 生成配置和 MCP 的后台地址 |
| AGENTGROUPS_TOKEN | 无 | MCP 身份凭据，由生成配置提供 |

更换端口时设置 PORT 和 AGENTGROUPS_URL，重新 setup 并更新客户端配置。后台从项目根目录启动，MCP 使用绝对路径、可从任意工作目录启动。

`.local/chat.sqlite` 保存消息和读取进度。重启将活动讨论标记为中断，不会自动续跑。备份时停止后台后复制整个数据目录；每个数据目录只运行一个后台进程。

页面初始化取得本机用户凭据；Host、Origin、自定义请求头检查阻止第三方网页取得页面权限。此版不提供共享 Windows 账户隔离，不适合公网发布。

## 开发

```powershell
pnpm check
pnpm test
pnpm build
git diff --check
```

测试使用内存 / 临时数据库；浏览器验收使用 `.local/qa`，与正式数据隔离。构建输出在 dist/ 和 public/app.js，修改后重新 build。

- [原始方案](docs/group-chat-plan.md)（设计讨论归档）
- [接口约定](docs/api.md)
- [接入指南](docs/client-setup.md)
- [验证记录](docs/verification.md)
