# 2026-09-27 安全审计修复

当前交付为 `release-security/win-unpacked`，服务协议 8。安全审计、数据权限迁移、回归测试与实际桌面验证结果见 [SECURITY-AUDIT.md](SECURITY-AUDIT.md)。以下界面版本记录是历史结果，不代表旧包已包含本轮安全修复。

---

# 2026-09-27 界面第七版

当前交付为 `release-ui-v7/win-unpacked`，服务协议 7。主题与语言入口、贯穿原生窗口按钮下方的分隔线、日历标题自动保存和外部点击关闭已完成。最终源码通过 55 项浏览器测试、64 项后端测试、TypeScript/Vite 构建和翻译词条检查。公开前检查覆盖源码、可达 Git 历史与桌面包，未发现规则匹配的明显凭据、个人主目录路径或私有运行数据。详见 [UI-V7.md](UI-V7.md)。

实际打包 Electron 的入口、标题栏尺寸、日历自动保存和外部点击关闭，以及主题、三语言和重启恢复检查通过。桌面与服务托管网页资源均与最终构建逐文件一致。

以下为历史版本验证记录。

---

# 2026-09-27 界面第四版

当前交付为 `release-ui-v4/win-unpacked`，服务协议 6。独立 32px 主题顶栏、线条图标及默认收起的规划面板已完成。16 项浏览器回归、实际桌面主题/语言/登录检查及包扫描通过。详见 [UI-V4.md](UI-V4.md)。

以下为历史版本验证记录。

---

# 2026-09-27 界面第三版

当前交付为 `release-ui-v3/win-unpacked`，服务协议 6。后端 62 项及本轮相关界面回归通过；实际桌面标题、原生窗口覆盖区、语言和登录持久化检查通过。详见 [UI-V3.md](UI-V3.md)。

以下为历史版本验证记录。

---

# 2026-09-27 工作界面第二版

当前交付为 `release-workspace-v2/win-unpacked`，服务协议 5。根目录快捷方式和启动脚本指向此版本。功能与升级方式见 [WORKSPACE-V2.md](WORKSPACE-V2.md)。

- 后端全量 61 项通过。新增用户名迁移与大小写去重、用户名和邮箱登录、90 秒邮件限流，以及真实 LangGraph 三档权限暂停/批准/拒绝/恢复、不重复写入测试。
- 浏览器 36 项已在全量与修复后的定向回归中逐项通过，覆盖工作首页、模型路由与滑条、绿色成功提示、用户名表单、记住登录、语言切换、历史列表、分栏拖动与键盘比例调整、日历和研究。修正旧路由与文案断言；历史 HTML 拖动使用完整鼠标移动事件。
- 截图检查修复窄分栏日历日期重叠：日历保留最小可读宽度，功能区域可横向滚动。历史列表关闭时，鼠标未移出触发条不会重新打开。
- 实际打包 Electron 隔离测试通过：普通账号工作首页、内置 Turnstile 组件加载、记住登录跨重启恢复、临时登录重启清除、注销撤销、语言选择与桌面语言偏好持久化。
- TypeScript/Vite、PyInstaller、Electron 目录打包通过；包检查未发现工作区数据、配置密钥或私有运行文件。
- 自动测试使用隔离账号/数据库及模拟模型、邮件或验证码响应，没有实际发送 SMTP 邮件或完成生产 Cloudflare 挑战；不把模拟验证当作外部服务的真实成功证据。

以下为历史版本记录。

---

# 2026-09-27 普通账号工作区、成功提示与记住登录

当前交付目录为 `release-user-workspace/win-unpacked`，服务协议 4。根目录快捷方式和启动脚本指向此版本。

- 注册成功与验证码发送成功改为绿色提示框；登录失败仍显示错误样式。
- 普通账号默认进入聊天首页，开放聊天、工作模式和个人模型配置。普通账号的数据库、模型配置、集成凭证、执行检查点按账号隔离；主数据库保留登录账号。管理员原有工作区保留。
- Worker 遍历各账号队列，执行上下文与心跳线程继承账号范围，检查点和实验目录分别存储；测试覆盖真实 LangGraph 内部线程使用正确模型凭证和个人规划数据。
- 「记住下次登录」默认不勾选，勾选为 30 天持久 Cookie 和服务端会话；未勾选使用临时 Cookie，后端有效期 24 小时。Cookie 为 HttpOnly/SameSite=Lax；退出撤销服务端会话，不保存明文密码。
- **后端全量 56 项通过**：跨账号读写拒绝、并发账号模型隔离、普通账号后台任务执行、记住登录有效期和注销等。
- **浏览器全量 26 项逐项通过**：真实本地 API/Worker 下普通账号聊天完成、工作日历、个人模型添加，以及注册成功绿色样式和记住选项提交。外部验证码仍使用模拟响应。Windows 测试运行器结束时的开发服务清理由人工终止测试进程完成。
- 已查看 `test-results/register-success-green.png` 和 `test-results/regular-user-home.png`，确认绿色提示框及普通用户聊天首页。
- 新打包 Electron 在正常 Windows 环境、独立账号/数据/隐藏窗口中验证通过：普通账号聊天与工作日历、勾选记住后的完整程序退出/重新启动仍登录、退出撤销、临时会话完整退出/启动后返回登录页。持久化测试使用测试数据库会话和对应 Cookie 有效期，不操作真实人机挑战。
- TypeScript/Vite、PyInstaller、Electron 打包完成；新包扫描未发现用户数据库、环境文件、前端密钥匹配。真实 Turnstile/SMTP 本轮未重新测试，仍保留桌面内嵌验证流程。

下面为历史版本记录。

---

# 2026-09-27 按用户要求恢复桌面内嵌验证

当前产物：`release-embedded-auth/win-unpacked`，根目录快捷方式与 `start.ps1` 指向此版本。之前默认使用外部浏览器的方案不符合用户要求，已从登录/注册页面移除。

- 用户确认 Ctrl+Shift+R 后出现新版入口，说明此前桌面仍显示旧页面。启动 URL 增加每次启动的随机参数并要求重新校验缓存；HTML 返回 `Cache-Control: no-store`。
- Turnstile 直接在桌面登录/注册页面加载。统一使用当前运行时 Chromium/OS 版本的浏览器标识，移除应用/Electron 附加标识；不修改 JavaScript 浏览器属性或验证结果。通过只读 preload 标记区分桌面环境，保留 sandbox/contextIsolation 和禁用 Node 集成。
- 存储访问权限仅允许本机工作区内的 Cloudflare 验证框；其他权限仍拒绝。该调整属于兼容性尝试，尚无证据证明原 600010 由此权限引起。
- 后端专项 6 项通过，包括新增加的 HTML 缓存策略；浏览器专项 7 项逐项通过，包括内嵌失败重试、用途切换、不打开外部窗口以及浏览器标识/权限范围。测试验证码使用模拟响应。Windows 测试服务清理仍需在全部测试通过后手动终止运行器。
- TypeScript/Vite、后端打包和 Electron 打包完成。新包 5394 个 asar 条目、171 个后端资源扫描未发现用户数据文件或前端密钥匹配。
- 正常 Windows 环境中的独立数据/隐藏窗口检查通过：内嵌 Turnstile 脚本存在、外部验证按钮不存在、preload 桌面标记存在、运行时浏览器标识和 HTML 缓存策略生效、匿名请求 401、测试会话后聊天与工作日历正常。
- **真实 Cloudflare 600010 是否解决仍待用户手动验证；不能把上述模拟/窗口检查当成真实验证成功。** 更新必须先退出托盘中的旧进程，重新启动新版，使主进程浏览器设置生效。

以下为历史版本记录。

---

# 2026-09-27 桌面浏览器验证修复

- 用户确认同一本机地址在普通浏览器可以完成 Turnstile，桌面内置浏览器返回 600010；没有据此认定具体网络或浏览器组件故障。
- 桌面改为系统浏览器验证，服务端校验真实 Turnstile 后由桌面轮询获取完成状态；私密凭证不进入浏览器地址，仅保存在桌面内存和服务端摘要中。验证绑定登录/注册用途、从创建起 5 分钟过期、原子单次消费。网页原有注册登录方式保留。
- 全部后端测试 **51 项通过**，包含未验证拒绝、私密凭证校验、登录与注册用途隔离、重放拒绝、过期、错误 hostname/action、禁止验证凭证生成另一个凭证、跨站保护、限流，以及真实本地登录 Cookie 和邮箱验证码流程（外部 Cloudflare/SMTP 使用模拟响应）。
- 浏览器专项 **6 项逐项通过**：桌面浏览器入口/结果更新/重置、注册用途切换、独立验证页、失效链接、错误码显示及脚本加载重试、系统浏览器 URL 允许范围。Turnstile 脚本使用模拟响应。Windows 下测试运行器清理开发服务未自动退出，确认六项通过后手动结束测试进程。
- TypeScript/Vite、PyInstaller 和 Electron 目录打包成功；新版位于 `release-browser-auth/win-unpacked`，服务协议为 3，拒绝复用旧服务。
- 正常 Windows 环境下隐藏窗口与独立数据目录的打包应用检查通过：浏览器验证按钮显示，桌面不加载 Turnstile 脚本，匿名工作区返回 401，测试会话后的聊天/日历可用，渲染进程无 Node require/process。
- 新包扫描 5392 个 asar 条目、171 个后端资源，未发现用户环境文件、用户数据库、配置密钥文件或前端密钥匹配。没有修改主用户数据或停止旧应用；根目录快捷方式已指向新版。
- **尚未完成新版真实 Cloudflare → 桌面回传的用户操作验证，也未验证真实 SMTP 投递**。用户先退出系统托盘内旧应用，再从根目录快捷方式启动新版，点击「在浏览器中验证」，验证成功后返回桌面继续。

以下保留此前交付记录，旧版本路径、协议和配置状态不代表当前状态。

---

# 2026-09-27 账号、工作模式和模型配置验证

本次结果：

- 后端回归 45 项通过；随后补充规划工具聊天的模型与思考强度测试，账号与模型专项 15 项全部通过（总计 46 项）。
- 浏览器全量回归 16 项通过，包含原有聊天历史、任务清单、日历拖动与人工确认工作流。
- 本机模拟供应商验证完整 HTTP 调用：自动发现模型、加入列表、选择模型、滑条强度、入队、Worker 调用及响应显示。未消耗外部模型服务。
- TypeScript 检查、Vite 构建、PyInstaller 独立后端和 Electron 目录打包成功。
- 正常 Windows 用户环境中的打包 Electron 验证通过：登录页、测试会话后的聊天页和工作日历分栏；未登录工作区返回 401；服务协议为 2；渲染页面没有 Node require/process。使用独立测试数据与隐藏窗口，未修改主数据。
- 检查了浏览器注册、分栏、模型设置和日历截图。截图位于 test-results。

未验证：真实 Turnstile 成功挑战、真实 SMTP 邮件投递、真实供应商推理。真实 Windows 用户的 Turnstile 和 SMTP 环境变量均未配置；使用方式见 [账号和模型说明](ACCOUNTS-MODELS.md)。没有自动创建主工作区管理员。

本次源码目录没有 Git 仓库，因此这些是本地文件和打包产物，不是已提交或推送的更改。下面保留旧版历史验证记录，涉及项目和知识库入口的描述不代表新版行为。

---

# 本次交付验证

## 任务清单与日历增量（2026-09-27）

- TypeScript 严格检查与 Vite 生产构建通过。
- **31 项后端测试通过**。规划新增覆盖：时间区间／时区校验、并发编辑冲突、软删除与撤销、区域隔离、重复绑定阻止、OAuth state 单次消费与 PKCE、凭据不回传、Google 分页／读写／冲突／外部删除、远程删除冲突保留本地时使用新 ID、TickTick batch 创建与完成、MCP 生命周期及聊天中断恢复不重复写入。
- **12 项 Chrome 浏览器测试通过**，包括原有 9 项和新增 3 项规划流程：自定义清单及编辑、任务保存／完成／刷新／删除撤销、5 分钟真实鼠标移动与拉伸、Esc 取消、键盘微调、拖动创建、日周月切换、两版滴答设置、390px 编辑面板和减少动态效果。
- 新打包 Electron 在独立端口、独立数据目录完成冷启动、日程创建与刷新恢复、MCP 工具发现、TickTick 区域切换与 Token 输入检查；无页面异常。安全选项仍为 sandbox=true、contextIsolation=true、nodeIntegration=false。
- 新包 `release-planner/win-unpacked` 的 asar 路径及外置资源检查未发现 `.env`、用户数据库、配置密钥文件或前端密钥匹配；certifi 的公开 CA 证书包属于正常依赖。
- 真实 Google／滴答账号 OAuth、写入及跨端同步**尚未端到端验证**；以上网络适配器测试使用模拟响应。真实模型工具循环也使用模拟模型响应，未产生付费调用。
- Notion Calendar 已实现的交互与未包含功能见 [PLANNER.md](PLANNER.md)，不宣称全功能一致。
- 可复查：`backend/tests/test_planner.py`、`tests/planner.spec.ts`、`scripts/planner-desktop-check.mjs`、`test-results/planner-desktop.json`、`test-results/planner-desktop.png`。

日期：2026-09-26。此文件记录实际验证范围，不代表生产部署认证。

## 已验证

- TypeScript 严格检查及 Vite 生产构建通过。
- **20 项** FastAPI / LangGraph 测试通过，覆盖：报告导出与重复保存、持久化人工审核恢复、取消任务、原子领取队列、过期任务恢复、项目关联校验、来源地址限制、并发备注保存、中文片段检索、多轮聊天持久化、对话隔离、真实模型消息历史协议、生成期间取消、聊天并发入队及旧轮次重试保护、重命名与排序持久化、旧记录迁移、并发新增对话保留、删除期间取消与撤销。
- 真实模式的研究分支使用模拟模型和搜索响应，验证补充检索、分支终止和 token 累计。这是协议与流程测试，不是实际供应商质量评测。
- **9 条** Chrome 真实浏览器端到端测试通过：新建研究 → 等待审核 → 刷新恢复 → 跳过实验 → 生成报告 → 保存知识库 → 导出；创建和编辑项目、编辑文档、全局搜索、主题持久化；390px 窄屏导航；多轮聊天与历史恢复；助手菜单键盘切换并发起研究；弹窗关闭、焦点恢复与减少动态效果；右键重命名、删除与撤销；真实鼠标拖动后刷新恢复顺序，键盘菜单和取消编辑。
- Electron 开发窗口与打包后的 **Sakuya Agent.exe** 均已验证：加载聊天首页、选择助手、切换研究列表、打开新建任务对话框。检查 `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`。
- 真实读取 Python 官方 asyncio 文档与 GitHub 的公开 Spoon-Knife 仓库成功，返回了网页正文、固定提交的代码资料和目录。
- 主页面和报告页面已截图检查，无浏览器未捕获异常。
- 升级 Electron 后 npm audit 返回 **0 项已知漏洞**。这是依赖数据库在检查时的结果，不等于软件没有未知漏洞。

## 独立启动验证（2026-09-27）

- `scripts/startup-check.mjs` 已通过：移除 PATH 中的 Node/Python，启动冻结后端、执行 LangGraph 演示聊天、复用已有服务、停止并重启后恢复数据。
- 新桌面包在没有开发服务器的独立端口冷启动成功；网页入口路由、关闭桌面后保留网页服务、重新打开桌面、最终退出清理后端均已通过。
- 占用端口的其他应用不会被关闭；打包资源扫描确认包含独立后端与网页文件，没有把 `.env`、配置密钥文件或工作区数据库打进去。
- 20 项后端行为测试仍通过。

## 尚未验证或尚未包含

- 真实 Windows 用户环境中未发现本项目识别的模型与 Tavily 密钥；没有进行付费模型端到端调用，也没有测量回答准确率或引用支持率。
- 本机没有 Docker；容器命令、审核流程和不可用时的行为已经实现，但真实容器实验尚未运行。
- 不是完整仓库自动复现平台。代码读取是有界的，实验仅使用标准库和已保存资料。
- 本地单用户存储，没有认证、多租户或公网部署验证。
- 桌面包已内置 Python 服务；当前未签名，未验证 macOS/Linux 分发。

## 可复查产物

- `backend/tests/test_workflow.py` / `backend/tests/test_chat.py`：后端行为测试。
- `tests/workspace.spec.ts` / `tests/chat.spec.ts` / `tests/history.spec.ts`：浏览器端到端测试。
- `scripts/desktop-check.mjs`：原生 Electron 检查。
- `scripts/visual-check.mjs`：页面截图。
- `evals/tasks.jsonl` / `scripts/evaluate.py`：后续真实模型评测入口。
- `.data`：本机持久化数据，已排除出版本控制。
- `release/win-unpacked`：Windows 桌面客户端构建产物。
# English interface and initial repository — 2026-09-27

- Web build and TypeScript checks passed. Vite reports a non-blocking bundle-size warning (main JavaScript bundle exceeds 500 kB).
- The existing browser suite plus the first four language scenarios passed: 30 tests. After final localization changes, the affected authentication and localization subset passed again (13 tests); all six final language scenarios passed, including two additional English-default/error cases.
- Backend regression suite: 56 tests passed.
- Translation coverage: 545 source-string occurrences checked against 547 catalog entries, with matching interpolation placeholders.
- Actual packaged Electron check passed using an isolated test profile: English/Chinese switching, accepted native locale values, and persistence after app restart. No real Turnstile challenge, SMTP delivery, external OAuth, or live inference was claimed by this check.
- Package scan: 5,396 archive entries and 171 bundled backend files; no unexpected workspace files, suspicious credentials/personal paths, or private runtime files were found by the configured checks.
- The initial Git snapshot was scanned for private/generated paths, credential patterns, personal home paths, and values matching local environment credentials. `.env`, `.data`, test artifacts, build caches, dependencies, and binaries are excluded.
- Repository documentation defaults to English and links to `README.zh-CN.md`. Existing user content and original execution logs retain their original language.
