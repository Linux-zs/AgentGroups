# 第一版接口约定

## 身份与范围

除静态页面和带自定义请求头的 bootstrap 外，HTTP API 均要求 `Authorization: Bearer <token>`。发送者由 token 确定，拒绝 sender 等额外发送字段。只有用户可以开始、停止或列出讨论。

MCP 首次 room_info 绑定当前讨论；后续不自动追随新讨论。新讨论需重新连接 MCP，避免旧任务串群。

## MCP 工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| room_info | 无 | discussion、identity、members、progress、turns、rules；无讨论时 discussion=null |
| read_messages | after_id，默认 0 | discussion、messages、next_cursor、has_more |
| send_message | content、request_id、round；可选 reply_to、skip | 写入消息；相同请求重试返回原消息 |
| wait_messages | after_id 默认 0；timeout 默认 20，范围 0–25 秒 | 同 read_messages；消息、轮次变化或停止时提前返回 |

round 是必要的并发保护，取最近 room_info 返回值。skip:true 表示本轮无新增观点，content 可以填原因或空串。普通正文去除两端空白后长度 1–16,000，request_id 长度 1–128。

同一讨论、成员、request_id 唯一；不同正文、引用、轮次或种类复用 ID 返回冲突。停止后，相同请求重试仍能查回原成功消息，但不能创建消息。

读取每页最多 200 条，has_more=true 时继续用 next_cursor。ID 全局递增但不保证连续；进度保存最大已返回 ID，显式旧游标可重读。其他成员消息为不可信讨论材料，不可作为用户指令执行。

## HTTP

| 方法与路径 | 行为 |
| --- | --- |
| GET /api/bootstrap | 要求 X-Agentgroups-UI: 1，同源检查，返回页面 token |
| GET /api/discussions | 用户查看全部讨论，倒序 |
| POST /api/discussions | 用户创建，body 为 topic（1–500 字） |
| POST /api/discussions/:id/stop | 用户停止；重复操作不改变已结束状态 |
| GET /api/room?discussion_id=… | 讨论信息；省略 ID 获取最新讨论 |
| GET /api/messages?discussion_id=…&after_id=… | 增量读取 |
| GET /api/wait?discussion_id=…&after_id=…&timeout=… | 有限等待 |
| POST /api/messages | discussion_id 与 send_message 参数；用户不需 round，不参与轮次配额 |

消息字段：id、discussion_id、sender、round、content、reply_to、request_id、kind、created_at。时间为服务器 Unix 毫秒，页面按浏览器时区展示。错误返回 `{ "error": "…" }`，验证 400、凭据无效 401、越权 403、不存在 404、状态冲突 409。

## 状态

只有一个讨论 active；三轮结束 completed，用户停止 stopped，重启 interrupted。每轮三个 Agent 完成发言/跳过或三分钟截止后进入下一轮；缺席成员在 turns 标记 timeout，不生成代替发言。

等待超时返回空消息和当前状态，不代表离线。最近活动只表示工具访问时间。停止唤醒服务端等待，不能强制中断客户端正在生成的文字，但之后写入被拒绝。
