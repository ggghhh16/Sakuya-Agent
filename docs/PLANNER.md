# 任务清单、日历与聊天规划

入口：工作 → 任务清单 / 日历。也可以从聊天顶部「打开日历」进入。

## 本机功能

- 自定义清单名称和颜色；每个清单可绑定一个 Google 日历，以及一个国内滴答或国际 TickTick 清单。一个远程集合只允许绑定一个本地清单。
- 任务快速输入、备注、地点、优先级、完成／恢复、时间安排、筛选、搜索、复制、删除与短时撤销。
- 日／周／月视图、迷你月历、今天、当前时间线、重叠日程分栏、全天及跨日显示。
- 空白时间区拖动创建，拖动时间块移动，上下边缘拉伸时长，均以 5 分钟为单位；拖动到边缘自动滚动，Esc 取消。
- 左侧未安排任务拖入日历；全天和月视图中的事件可拖到其他日期。键盘 Enter 打开详情，Alt+↑/↓ 移动 5 分钟。
- 快捷键：T 今天、C 新建、D/1 日、W/2 周、M/3 月、←/→ 上一页／下一页；输入和弹窗期间不拦截文字。
- 编辑抽屉、连接弹窗、删除确认和提示均保留进入／退出动画，支持减少动态效果、焦点限制和窄屏。
- SQLite 持久化；修改带 revision，过期编辑返回冲突，避免覆盖其他窗口或助手刚刚保存的内容。

## 连接账号

打开规划侧栏右上角「连接设置」。国内／国际账号分别授权、分别保存，切换设置不会更改已有清单的区域。

### Google 日历

1. 在 Google Cloud 启用 Calendar API，创建桌面 OAuth 客户端。测试应用需要添加自己的测试账号。
2. 在应用内填写 Client ID / Client Secret，点击「保存并连接」，再点击授权链接，在系统浏览器完成授权。
3. 回调地址显示在设置中，默认 `http://127.0.0.1:8120/api/integrations/google/callback`。服务使用其他端口时会相应变化。
4. 编辑一个本地清单，选择对应 Google 日历并保存，点击同步导入已有事件。

请求范围仅包含 Calendar events 读写和 CalendarList 只读。OAuth state 单次使用，10 分钟过期，Google 启用 PKCE；有 refresh token 时自动刷新。

### 国内滴答 / 国际 TickTick

两种连接方式：

- 个人 Token：在对应服务网页端「设置 → 账号 → API Token」创建，粘贴到应用内「个人 API Token」，验证后保存。
- OAuth：在对应开发者中心注册应用，填入界面显示的回调地址，再在本应用填写 Client ID / Client Secret 并授权。

授权后编辑本地清单，选择区域及远程清单。任务会同步到滴答；独立日程只同步到 Google。

令牌和 Client Secret 仅保存在后端 SQLite 的 integration_secret 记录，不通过工作区／设置 API 返回，不交给模型。当前沿用本机单用户存储方式，**数据库中的令牌未加密**。不要分享 `.data`。断开连接会清除本地令牌，不代表已在供应商端撤销授权。

## 同步与冲突

- 点击同步，或勾选每分钟自动同步。自动同步仅在规划视图打开、网页可见且无编辑弹窗时运行；没有后台云端定时服务。
- Google 读取以当前浏览日期前 60 天、后 120 天为范围；已有绑定记录即使移出范围也会单独核对。
- Google CalendarList 和事件列表处理分页。滴答读取项目内未完成任务，已关联的任务单独读取以检查完成状态；不会凭空推断一项缺失任务已经删除。
- 同步前比较远程版本；Google 写入同时使用 If-Match。滴答使用读前比较，公开接口不能提供与 Google 相同的原子条件写入保证。
- 双端修改显示「同步冲突」，可在详情中选保留本地或远程。失败保留本地内容并显示错误。没有将失败显示为成功。
- Google 使用固定的事件 ID；滴答使用带固定任务 ID 的 batch 接口，重试前核对记录，减少超时后的重复创建。
- 本地删除保留记录，远程删除完成后不能撤销。Google 外部删除会反映到本地；滴答读取不到已关联任务时提示核对，不自动把它当成删除。
- 滴答公开接口没有已核实的恢复已完成任务操作。本地恢复后若需同步，会明确提示在滴答恢复再同步。

## 聊天 MCP

聊天页启用「任务与日历 MCP」，并配置支持 function calling 的真实模型。演示模式不会调用工具。

聊天 Worker 通过 MCP Streamable HTTP 与本机 `/api/mcp/planner` 通信，执行 initialize、tools/list、tools/call；提供读取规划、创建清单、创建／更新／删除任务与日程、列出 Google 日历／两版滴答清单及同步工具。请求必须包含 `X-Sakuya-Client: workspace`，沿用本机来源校验。

可以直接说：

> 读取我的任务和日历，把「准备演示」安排到明天 14:00–15:00，使用工作清单并同步。

助手使用界面时区，先读取再修改，显示工具执行结果。上下文和工具结果持久化；重试恢复到原调用位置，已确认成功的写入不重复执行。中断时无法确认结果的操作要求先读取核对。工具调用错误不意味着此前的操作被回滚。

## 与 Notion Calendar 的范围差异

本次实现其主要时间网格和编辑交互，**不是 Notion Calendar 全功能复刻**。尚未包含 Notion 数据库集成、会议可用性分享、邀请参会者／RSVP、会议服务创建、多个 Google 账号同时在线、任意显示时区切换、自定义重复规则编辑和系列事件批量修改。Google 已有重复事件按实例导入，修改实例不会重写整个系列规则。

外部账号真实端到端验证需在本应用完成授权；模拟 HTTP 测试不能替代真实供应商验证。

## 接口依据

- [Google 桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [国内滴答官方 Open API](https://developer.dida365.com/docs/openapi.md)
- [国际 TickTick 官方 Open API](https://developer.ticktick.com/docs/openapi.md)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Notion Calendar 日历与事件操作](https://www.notion.com/en-gb/help/manage-your-calendars-and-events)
