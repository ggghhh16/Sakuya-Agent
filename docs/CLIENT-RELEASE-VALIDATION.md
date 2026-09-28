# Client 发行准备与验证（2026-09-28）

此记录对应 Client v0.2.0 安装包的构建与验证。原完整版本保留 `v0.2.0` 标签并标记为 Dev，Client 使用独立的 `v0.2.0-client` 标签。

## 产物

| 文件 | SHA-256 |
| --- | --- |
| `release-dev/Sakuya-Agent-Dev-Setup-0.2.0-x64.exe` | `135c7e91c4d9c05f08e7084829b080845848868bb12d882a4fba91b7d68ffda9` |
| `release-client/Sakuya-Client-Setup-0.2.0-x64.exe` | `31c0042ab4e9d4f6674138f40ed8904f7881267e4a077e3ab1b0b2c147d1e568` |

Dev 安装包仅复制并更名，与原 v0.2.0 安装器哈希完全相同。原 `release-v020` 安装器及其程序内容没有更改。两个产物目录均有 `SHA256SUMS.txt` 和 `RELEASE-NOTES.md`。

## 本轮验证

- 全量后端测试：115 项通过。随后调整 Client 聊天提示，相关 13 项后端测试再次通过。
- TypeScript、两种前端构建及三语言覆盖检查通过。
- 最终 Client 程序真实桌面验证通过：首次免登录、没有工单和诊断入口/接口、无登录验证码脚本、任务重启保留、演示聊天完成、与 Dev 同时运行、Dev 仍要求登录、跨来源访问拒绝、旧版环境变量不被 Client 使用。
- 最终 Client 安装器解包后 221 个文件与已验证程序逐文件 SHA-256 一致；没有执行影响用户真实环境的安装/卸载。
- 工作文件、Git 历史和打包内容扫描未发现凭据或用户数据；桌面导航和服务身份安全检查通过。
- Dev 浏览器全量回归：79 项通过、1 项流式中间状态测试失败。失败时完整回复已经出现，但测试未捕获中间状态；该项单独重复 3 次为 1 次通过、2 次失败。使用**未修改的已发布 v0.2.0 程序**对照重复 3 次均通过。因此不能声称源码浏览器回归全部通过，也未将失败确定为旧版既有问题。聊天实现的 Dev 文案保持原值，原 Dev 安装包没有被替换或重建。
- 真实模型、SMTP、Turnstile 和外部 OAuth 没有做真实凭据调用；安装包未作代码签名。

## 本地证据

- `.build/client-package-final.log`
- `.data/client-validation-1790589419821/result.json` 与桌面截图
- `release-client/Sakuya-Client-Setup-0.2.0-x64.validation.json`
- `.build/edition-release-manifest.json`
- `.build/dev-e2e-client-change.log`
- `.build/dev-stream-retest.log`
- `.build/baseline-stream-check.log`

## 发布入口

- [Client v0.2.0](https://github.com/ggghhh16/Sakuya-Agent/releases/tag/v0.2.0-client)
- [Dev v0.2.0（原完整版本）](https://github.com/ggghhh16/Sakuya-Agent/releases/tag/v0.2.0)

Release 中的 `SHA256SUMS.txt` 对应各自安装包。Dev 保留原标签、原程序内容和更新记录；Client 标签单独对应包含版本隔离实现的源码。以 GitHub Release 的实际发布状态和资产为准。
