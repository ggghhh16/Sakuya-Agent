# 顶栏入口与日历标题自动保存

桌面输出为 `release-ui-v7/win-unpacked`，服务协议仍为 7。退出旧版（包括托盘）后，从根目录快捷方式启动新版；保留原有用户数据。

- 主题设置和语言菜单移动到左侧 Sakuya 标题右边，浅深切换保留在右侧。两个主题控件同步显示当前选择。
- 桌面标题条维持 32px，原生窗口按钮覆盖区为 31px，让底部 1px 分隔线贯穿整个窗口，包括最小化、最大化和关闭按钮下方。
- 日历编辑浮窗在点击外部时关闭。当前时间块单击也会关闭；拖动当前块仍临时隐藏浮窗，松开后恢复。
- 标题输入停止约 700ms 后自动保存；点击外部会立即提交尚未保存的标题。已有日程只自动更新标题，新草稿有有效标题后自动创建。自动保存和手动保存使用同一个条目 ID 与修订号，串行处理，保留请求期间继续输入的内容。
- 已有日程的备注、地点、时间等字段仍通过“保存”提交。自动保存失败时保留浮窗和错误提示，避免丢失标题；未命名草稿在关闭时不会创建日程。

## 检查命令

最终源码的 55 项浏览器测试、64 项后端测试，以及构建、翻译词条检查通过。

实际打包 Electron 的入口位置、原生覆盖区与标题条尺寸、日历拖动、标题自动保存和外部点击关闭检查通过；主题与三语言的原生同步、非法值拒绝和重启恢复检查通过。隐藏窗口可能无法输出日历截图，因此截图不作为交互断言的前提。

```powershell
node scripts/build.mjs
node scripts/check-locales.mjs
.venv/Scripts/python.exe -m pytest backend/tests -q -p no:cacheprovider
node node_modules/@playwright/test/cli.js test
.venv/Scripts/python.exe scripts/check-publication.py
node scripts/verify-package.mjs release-ui-v7/win-unpacked
node scripts/check-calendar-desktop.mjs release-ui-v7/win-unpacked
node scripts/check-language-desktop.mjs release-ui-v7/win-unpacked
```

公开检查覆盖将提交的文件、可达 Git 历史、明显凭据模式、个人主目录路径与私有运行数据文件；桌面包另外扫描。测试使用隔离账户和本地数据，不代表真实模型、邮件验证码或外部日历服务已完成端到端验证。
