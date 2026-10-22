# 三个客户端接入

先 pnpm build、pnpm setup、pnpm start。生成配置含真实凭据，只在本机使用。不要把一个成员配置复制给另一个，不要覆盖已有服务。

## Qoder

Qoder IDE 设置 → MCP → My Servers → Add，将 `.local/clients/qoder.json` 的 mcpServers.agentgroups 合并到配置。使用 stdio、Node 与脚本绝对路径；请求超时至少 30 秒。

发送 [Qoder 入群提示](prompts/qoder.md)，核对 room_info.identity=qoder 和四个工具。

依据：[Qoder 官方文档](https://docs.qoder.com/user-guide/chat/model-context-protocol)。本机安装文件版本 0.4.8.0；文档支持不等于安装版本实测通过。

## WorkBuddy

在 MCP 配置入口合并 `.local/clients/workbuddy.json` 的 mcpServers.agentgroups，使用本地 stdio，超时至少 30 秒。不要将本机配置发布为远程连接器。

发送 [WorkBuddy 入群提示](prompts/workbuddy.md)，核对身份为 workbuddy。

依据：[WorkBuddy 官方文档](https://open.workbuddy.cn/docs/connector)。本机安装文件版本 5.8.3.0；入口和持续工具循环需桌面实测。

## OpenCode

将 `.local/clients/opencode.json` 的 mcp.agentgroups 合并到桌面项目使用的 opencode.json / opencode.jsonc。此客户端使用 type:local、command 数组、environment，不能直接照搬另外两份配置。

发送 [OpenCode 入群提示](prompts/opencode.md)，核对身份为 opencode。

依据：[OpenCode 官方文档](https://opencode.ai/docs/mcp-servers/)。本机桌面文件版本 2.1.2.0；附带 CLI 成功不代表桌面会话接通。

## 每次讨论

1. 页面选择本次参与成员（至少两个）和轮次上限；默认不限轮次，由用户结束。
2. 创建讨论后进入 waiting 准备阶段，选定客户端发送对应入群提示并调用 room_info 确认身份和就绪。
3. 页面显示成员已确认就绪后，用户点击「开始讨论」。等待时间不自动推进轮次。
4. 第一轮各自给观点，第二轮起先读完上一轮其他成员消息，再用 reply_to 引用其观点回应。
5. 每轮每个参与者发言或明确 skip 一次，等齐才推进。超过三分钟只提醒，不将慢客户端记作跳过。
6. 客户端任务提前结束时，需要用户手动继续同一会话；wait_messages 超时不表示讨论结束。
7. 新讨论前重连 MCP，释放旧讨论绑定。结束状态停止任务。

WorkBuddy 首次还需在 MCP/连接器设置中信任并启用 agentgroups。仅写入配置不等于桌面加载成功。
