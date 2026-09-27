# 日历交互更新

桌面输出：`release-ui-v6/win-unpacked`。根目录 `Sakuya Desktop.lnk` 和 `Sakuya Web.lnk` 指向此版本。后端协议维持 7，沿用原有用户数据目录。

- 点击已有时间块时，编辑浮窗出现在块的右侧或左侧，并随滚动、窗口尺寸和时间修改更新位置；视口不足时限制在可见区域内。
- 25 分钟及以下的时间块使用同一行显示标题与时间。
- 新草稿支持移动、跨日移动和调整上下边缘。拖动时临时隐藏浮窗，松开后恢复，保留标题、备注等字段；保存前不向后端写入。拖动中按 Esc 撤销本次移动，空闲时按 Esc 关闭编辑。
- “我的规划”“新建任务”“新建日程”改为图标按钮，保留悬停提示和无障碍名称。
- 日历工具栏最右侧提供 − / +，显示范围为 1–14 天并按账户保存；月视图禁用天数调整。从单日增加天数时保持当前日期在左侧。
- 周视图点击“今天”后，今天为最左列，向后显示所选天数。
- “我的规划”展开状态在任务清单和日历间切换时保持；刷新仍默认收起。
- 空白区域单击不创建日程。按住拖动才创建，终点按现有 5 分钟精度取最近刻度，不再额外增加 5 分钟。

## 验证

- TypeScript / Vite 构建、翻译词条检查通过。
- 17 项相关浏览器测试通过；最终工具栏布局调整后重新通过 5 项日历专项测试。覆盖单击、底边位置、相邻浮窗、草稿跨日移动、隐藏恢复、字段保留、Esc、缩放、复制后保存不覆盖原项、显示天数边界和持久化、图标及规划栏状态。
- 实际打包 Electron 检查通过：单击不创建、拖动新建与移动草稿、浮窗隐藏和恢复、保存后编辑、显示天数、切换任务和日历时规划栏保持展开。截图为 `test-results/desktop-calendar-v6.png`。
- 桌面测试使用独立账户和数据目录，不修改真实用户日程，也不调用外部日历服务。
- `verify-package.mjs` 检查前端、独立后端、私有工作区文件和明显凭据。

```powershell
node scripts/check-locales.mjs
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/calendar-interaction.spec.ts tests/planner.spec.ts tests/preferences-planner.spec.ts tests/ui-refinements.spec.ts
node scripts/verify-package.mjs release-ui-v6/win-unpacked
node scripts/check-calendar-desktop.mjs release-ui-v6/win-unpacked
```
