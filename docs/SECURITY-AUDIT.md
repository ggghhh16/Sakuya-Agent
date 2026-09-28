# 本地安全审计与修复记录 · 2026-09-27

本轮审计覆盖源码、可达 Git 历史、依赖公告、Windows 本地数据权限、构建产物、后端接口及实际打包桌面程序。确认的问题已在当前源码和 `release-security/win-unpacked` 修复。服务协议更新为 8；本地根目录两个快捷方式和 `start.ps1` 已指向新版。本次源码交付包含修复、回归测试与审计记录；本地程序、用户数据及恢复备份不纳入 Git。

## 确认的问题及处理

| 问题 | 风险与触发条件 | 修复与证据 |
| --- | --- | --- |
| 本地凭据及数据库权限过宽 | `.env`、`.data` 原本允许其他 Windows 用户读取，Authenticated Users 还具有修改权限 | 敏感数据限制为当前 OS 用户、SYSTEM、Administrators。启动时自动保护；实际已有目录完成迁移并复查 ACL |
| 旧设置接口保留密钥并更换地址 | `PUT /api/settings` 可在没有重新输入密钥时更换模型接收地址 | 与供应商接口采用相同要求；更换地址必须重新输入密钥；迁移到供应商列表后禁用旧接口 |
| 旧密钥副本残留 | 配置迁移后顶层 `api_key` 仍存在，删除供应商不能删除该副本 | 保存供应商列表时移除废弃顶层字段，已迁移本机配置；有效供应商密钥不变 |
| 请求大小可绕过 | 只检查 Content-Length，分块或伪造长度可绕过 | 解析前累计真实字节，限制 1 MB 和 15 秒；原生分块请求返回 413 |
| 错误信息泄露敏感输入 | 默认校验错误包含 input/ctx；错误先截断再脱敏可能留下密钥前缀 | 校验错误只保留类型、位置和通用描述；先脱敏再截断；覆盖模型、集成和环境中的凭据 |
| 抓取目标 DNS 检查不可靠 | 检查与连接分别解析 DNS；检查使用的代理可能与实际连接不同 | 直连固定已检查的公网 IP，保留原 Host 与 TLS SNI；代理显式传给客户端，每次重定向重新检查 |
| 代理头可影响限流来源 | 本机 Uvicorn 默认信任 loopback 发来的 X-Forwarded-For | 生产和开发入口禁用代理头信任；打包程序对不断变化的伪造 IP 仍返回 429 |
| 不可信 Markdown 自动加载图片 | 报告、工单、聊天、知识库可自动请求攻击者图片地址 | 所有 Markdown 渲染禁止图片；真实浏览器验证没有图片请求及 HTML 执行 |
| 页面缺少内容与嵌入限制 | 缺少 CSP 和禁止被其他网页嵌入的响应头 | 生产服务增加 CSP、frame-ancestors、X-Frame-Options 等；保留 Cloudflare 验证所需域名，实际 Electron 阻止内联脚本 |
| 本机服务复用只依据公开声明 | 占用端口的进程可伪造 health 响应，让桌面加载其登录页 | 生产桌面拒绝复用非自身启动的服务；伪造完整健康响应仍被拒绝。明确指定的开发模式由开发脚本管理服务 |
| 会话撤销后事件流继续读取 | 已打开的事件流原本只在建立连接时检查会话 | 每次推送前重新检查；撤销后停止输出 |

## 本地数据与残留

- 原数据目录由旧沙箱账号拥有，当前 Windows 用户无法直接修改它的权限。采用可恢复迁移：先复制，再逐文件校验 SHA-256，建立并校验权限受限的完整 ZIP 备份，最后替换旧目录。2339 个文件、291840713 字节在迁移时全部保留。
- 数据恢复备份保留在 `.build/private-backups/local-data-0ac567ece6c2473da7eb905bf7188226.zip`；同目录还保留 `.env` 内容备份。备份包含私有数据，受 Windows ACL 保护，并被 Git 与发布包规则排除；不是加密备份。
- 本轮失败重试产生的 `.env.secure-*` 临时副本已在确认与 `.env` 内容一致后删除。未删除用户聊天、工单、日历、模型配置或历史测试资料。
- 2026-09-27 审计时，原来的 `release`、`release-*` 旧目录和 `.build/release-assets` 历史归档未删除、未重新修补。2026-09-28 清理了项目根目录的 14 个历史发布目录（含旧安装包），仅保留当前 `release-security`；`.build/release-assets` 历史归档未参与此次清理。只使用当前包或根目录快捷方式；不要把历史归档当作已修复版本分发。
- `.gitignore` 补充数据库旁文件、HAR、私有配置与迁移临时目录规则。
- 发布扫描增加本机真实凭据的精确匹配，不输出值；对源码、历史、包内二进制和解压后的 PyInstaller 应用模块检查。历史测试配置中的合成字符串不当作真实工作区凭据。

## 验证

- 后端原有测试与新增安全回归共 77 项；完整套件及新增事件流检查通过。
- 相关真实浏览器回归 8 项通过，包括账号隔离、工单内部备注隐藏、多供应商路由、工具批准/拒绝、Markdown 自动请求阻止。
- 实际新打包 Electron 程序验证通过：匿名访问 401、无 renderer Node 访问、内联脚本被 CSP 拦截、伪造代理头仍触发 429、分块超限返回 413、普通账号演示聊天由实际后台执行完成。
- TypeScript/Vite 构建、PyInstaller 构建与 Electron 打包通过。Vite 的大 chunk 提示是现存构建提示，不是安全检测失败。
- npm audit 返回 0 条已知漏洞；PyPI 官方 JSON API 查询锁定和已安装的 61 个 Python 包版本，返回 0 条有效漏洞公告。未因本轮扫描修改依赖版本。
- 新包扫描：219 个物理文件、5402 个 ASAR 条目、171 个独立后端运行时文件；未发现扫描规则或本地真实凭据精确匹配。可达 Git 历史扫描 185 个 blob，无命中。

复验命令（PowerShell）：

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q -p no:cacheprovider
node node_modules/@playwright/test/cli.js test tests/security.spec.ts tests/accounts-workspace.spec.ts tests/tool-approval.spec.ts
node scripts/check-service-security.mjs
node scripts/check-security-desktop.mjs
node .tools/npm/package/bin/npm-cli.js audit --json
.venv/Scripts/python.exe scripts/audit-python-dependencies.py
.venv/Scripts/python.exe scripts/check-publication.py --package release-security/win-unpacked
node scripts/verify-package.mjs
```

`scripts/package.mjs` 现在会保护发布目录、执行包扫描，并在扫描通过后生成快捷方式。旧的 `scripts/startup-check.mjs` 属于无账号版本的历史检查脚本，不作为本轮验证依据。

## 验证边界

这是本轮已确认问题的修复记录，不是“绝对不存在漏洞”的保证。没有调用真实付费模型、执行真实日历写入、发送注册邮件或完成真实 Cloudflare/OAuth 授权；桌面测试使用隔离数据库会话。没有进行公网部署渗透测试或恶意内核/管理员权限攻击验证。配置仍由本机后端明文保存并以 OS 权限保护；同一 Windows 账号下的恶意进程和管理员不在这一隔离机制的保护范围内。

可信代理仍负责解析允许的公开域名；应用不能验证代理远端实际解析结果。模型供应商地址由已登录用户明确配置，仍支持有意使用的本机 HTTP 模型；它与模型/网页生成的研究资料 URL 使用不同权限规则。

实现参考：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[HTTPX 代理配置](https://www.python-httpx.org/advanced/proxies/)、[HTTPX 请求扩展](https://www.python-httpx.org/advanced/extensions/)。
