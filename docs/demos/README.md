# README 演示素材

三个 GIF 录自 Sakuya Agent 的真实 React 界面和 FastAPI 后端，基于 `983a7d55e5ae41a8df01c3ffc169754169ca681f`（GitHub main），录制日期为 2026-09-29。

| 文件 | 展示内容 | 验证 |
| --- | --- | --- |
| `01-chat.gif` | 发送消息、打开历史、刷新恢复 | 真实聊天存储；内置固定演示回复，不调用模型 |
| `02-tasks.gif` | 创建清单、添加任务、设置优先级、完成任务 | 真实本地任务 API 和界面状态 |
| `03-calendar.gif` | 拖动日程、拉伸时长、详情、周视图 | 界面检查 11:00–12:30，API 核对保存的 90 分钟时长 |

录制使用全新数据库、示例任务及 `demo@example.com` 演示账号。认证会话按照现有浏览器测试的方式在独立数据库中创建，不展示登录流程，也不改动生产认证逻辑。未使用用户数据、模型密钥、地图、OAuth 或外部同步服务；后端 API 没有被替换或模拟。

GIF 保留深色原始界面；额外添加标题栏和鼠标指示圈以便阅读。标题栏不是应用功能。截图按实际时间间隔播放，循环播放；使用固定调色板压缩。

## 重新录制

需要项目现有 Node/Python 依赖、Windows Chrome 和安装了 Pillow 的 Python。端口 5186、8136 须空闲。

```powershell
node scripts/record-readme-demos.mjs
# 将脚本输出的 CAPTURE_DIR 传给编码器：
python scripts/encode-readme-demos.py '<CAPTURE_DIR>'
```

如 Chrome 不在默认位置，可用 `DEMO_CHROME` 指定。编码器第二个可选参数为支持中文的字体路径，默认 `C:/Windows/Fonts/msyh.ttc`。

录制脚本启动并清理自己的后端、Worker 和 Vite 进程；每次使用 `.build/readme-capture/<timestamp>/data` 中的新数据目录，且不会读取项目 `.env`。原始帧、服务日志、帧时间记录与六帧预览留在被 Git 忽略的 `.build` 内。只有这三个 GIF、说明和录制脚本需要提交。
