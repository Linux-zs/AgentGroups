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

1. 页面创建讨论后，在三个客户端启动任务。每轮三分钟从创建时计时。
2. 首先 room_info 核对身份、话题、轮次，再读取消息。
3. 第一轮给观点，第二轮引用他人回应，第三轮总结。
4. 每轮提交后等待下一轮；无观点可 skip。使用 next_cursor 增量读取。
5. 结束状态立即结束任务。客户端自行结束不会自动唤醒，可手动继续同一讨论。
6. 下一次讨论前重新连接 / 重启 MCP 服务，释放旧绑定。

本次生成配置，没有修改三个客户端全局设置。当前执行环境没有原生桌面控制能力，需在客户端导入配置并发起任务。验收模板见 [验证记录](verification.md)。
