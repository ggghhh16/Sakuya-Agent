# 界面与日程助手更新

## 使用

- 设置中的上下文容量改为选择框。模型发现接口保留供应商返回的 `context_length`、`context_window`、`max_context_length`、`max_model_len`，据此提供不超过上限的选项；没有元数据时提供常用容量及自定义输入，保留未指定时的 32K 估算。容量用于上下文占比估算，不会改变远端模型本身的限制。
- 聊天框 `+` 中新增“日程-任务管理助手”。专用角色随聊天请求持久化，启用已有 MCP 工具、时区和批准流程；刷新后恢复角色。模型必须支持工具调用；演示模式不执行操作。
- 任务工具栏中的同步按钮位于“我的规划”左侧。
- 日历拖动创建时保留草稿预览。松开后浮窗在时间块右侧或左侧，靠近视口边缘时调整位置。修改标题和时间同步更新预览；保存失败保留草稿，取消清除，保存成功立即显示服务返回的正式条目。
- 语言菜单支持简体中文、English、日本語。界面、日期、登录页、桌面启动页和托盘支持三种语言；不改写用户内容。英文与日文词条集合及占位符由脚本检查。
- 设置旁提供浅深切换和主题设置。Sakuya、A/（暖色配色）、Notion（中性配色）各有浅深模式，选择持久化并适配原生标题栏。聊天记录抽屉内的旧主题按钮已移除。

## 桌面包

输出目录为 `release-ui-v5/win-unpacked`。服务协议升级到 7，避免新版界面复用不支持助手参数的旧后端。已有版本运行时，从托盘退出旧版后再打开根目录快捷方式；用户 `.data` 保持原有位置。

## 验证范围

- TypeScript / Vite 构建、翻译词条与占位符检查。
- 后端模型容量元数据、参数验证、助手角色持久化、专用指令、MCP 调度和恢复测试。
- 浏览器测试覆盖容量联动、三语言草稿保留、六种主题、助手请求、按钮顺序、草稿持续显示、相邻浮窗、失败保留、取消和保存。
- 打包内容扫描检查前端与独立后端存在，排除工作区数据、明显凭据与个人路径。
- 桌面检查使用隔离测试配置；模型返回和外部同步在自动化测试中使用替身，不代表已连接真实供应商、Google 或滴答账号完成端到端验证。

```powershell
node scripts/check-locales.mjs
node scripts/build.mjs
.venv/Scripts/python.exe -m pytest backend/tests/test_model_capacity.py backend/tests/test_planner.py backend/tests/test_workspace_revision.py backend/tests/test_accounts_models.py -q -p no:cacheprovider
node node_modules/@playwright/test/cli.js test tests/preferences-planner.spec.ts tests/language.spec.ts tests/planner.spec.ts tests/ui-refinements.spec.ts tests/workspace-revision.spec.ts
node scripts/verify-package.mjs release-ui-v5/win-unpacked
node scripts/check-language-desktop.mjs release-ui-v5/win-unpacked
```
