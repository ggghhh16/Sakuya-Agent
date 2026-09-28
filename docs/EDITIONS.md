# Dev 与 Client 发行版

同一份源码生成两个独立安装包。默认源码运行模式仍为 Dev。

| 项目 | Dev（原完整版本） | Client |
| --- | --- | --- |
| 安装标识 | `dev.sakuya.agent`（保持原值） | `dev.sakuya.client` |
| 程序及快捷方式 | Sakuya Agent | Sakuya Client |
| 默认端口 | 8120 | 8121 |
| 安装版用户数据 | 原 Sakuya Agent 用户目录 | `%APPDATA%/Sakuya Client/workspace` |
| 登录注册 | 保留原账户流程 | 无账户，打开即进入本地工作区 |
| 工单、Issue 诊断 | 保留；诊断由实验性开关控制 | 无入口，接口拒绝访问 |
| 模型、聊天、研究、任务和日历 | 保留 | 保留 |

Client 初次启动为空白工作区，不导入 Dev 的账户、密钥或数据，不生成工单和诊断示例。任务和日历可直接使用；演示聊天不调用模型，真实 AI 功能仍需在设置中添加自己的模型供应商和 API Key。Google/滴答等外部服务的授权按需配置，与 Sakuya 登录注册无关。

两个版本可以同时安装、运行和独立卸载；默认卸载保留各自数据。Dev 沿用原安装标识和数据目录，保持升级兼容。Client 的运行时用户目录、安装标识、快捷方式与端口均独立。Client 桌面版忽略 Dev 的 `SAKUYA_DATA_DIR`、`SAKUYA_DESKTOP_DATA`、`SAKUYA_ENV_FILE`、`SAKUYA_PORT` 和 `SAKUYA_DEV_URL`，防止继承旧环境变量后误用原版数据。需要覆盖 Client 设置时，使用独立的 `SAKUYA_CLIENT_DATA_DIR`、`SAKUYA_CLIENT_DESKTOP_DATA`、`SAKUYA_CLIENT_ENV_FILE` 和 `SAKUYA_CLIENT_PORT`；不要主动指向 Dev 的目录或端口。

## 构建

```powershell
npm run desktop:package:dev
npm run desktop:package:client
```

产物分别位于 `release-dev`、`release-client`。省略 `--installer` 可仅生成 `win-unpacked`。前端产物分别使用 `dist` 和 `dist-client`，后端使用 `.build/backend-dev` 和 `.build/backend-client`。构建不会修改原有桌面快捷方式或 `.build/active-release.txt`。

发行版由安装包中的 `package.json` 和后端 `edition.json` 决定；已打包版本不会因继承的 `SAKUYA_EDITION` 环境变量而改变身份。源码后端可以用 `SAKUYA_EDITION=client` 测试；未指定时始终使用 Dev。

## 验证

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q
node scripts/check-client-desktop.mjs 'release-client/win-unpacked/Sakuya Client.exe'
node scripts/verify-package.mjs release-client/win-unpacked client
```

桌面检查使用独立临时目录，覆盖首次免登录、功能移除、任务重启保留、演示聊天执行、Dev 仍要求登录、两个版本同时运行、跨来源请求拒绝，以及安装包身份不受环境变量改变。不会使用真实模型、邮箱或外部日历凭据。
