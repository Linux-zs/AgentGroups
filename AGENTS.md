# 项目上下文

本项目名为 agentgroups，目标是让 Qoder、WorkBuddy、OpenCode 通过共享群聊服务讨论问题。

开始项目工作前，请阅读 `README.md` 和 `docs/group-chat-plan.md`，以延续已有讨论。

## 当前范围

- 当前已实现本机第一版（Fastify、SQLite、stdio MCP、中文消息页）；以 README.md、docs/api.md 和 docs/verification.md 为当前实现与验证依据，原方案保留为归档。
- 三个客户端的真实接入、持续等待和自动唤醒能力均需要实测。
- 区分 CLI 新任务与现有桌面会话；不能用前者的成功宣称后者已经接通。
- 验证群聊必须使用来自不同客户端的真实消息，不能由单个模型模拟其他成员发言。
- 第一版使用 TypeScript、Node.js 24、Fastify 与 SQLite；本文档不代表已经授权部署、提交或推送。
