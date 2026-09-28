from . import db
from .edition import IS_CLIENT


def seed():
    if IS_CLIENT:
        return
    if db.all_items('project'):
        return
    project = db.put('project', {'id': 'project_welcome', 'name': 'Sakuya 知识助手', 'description': '示例项目 · 探索研究、问题诊断与技术支持的完整工作流。', 'repository': '', 'color': 'sage', 'is_demo': True})
    db.put('document', {'id': 'document_start', 'project_id': project['id'], 'title': '开始使用 Sakuya', 'content': '# 欢迎来到 Sakuya\n\n这里是你的研究与技术支持工作台。\n\n## 一次完整任务\n\n1. 创建项目，添加项目说明和可选的 GitHub 仓库。\n2. 新建研究或诊断任务，写清问题与约束。\n3. 在任务详情查看计划、执行记录和来源。\n4. 如果启用实验，审核脚本后再执行。\n5. 保存报告，并将结果关联到工单。\n\n## 演示与真实运行\n\n示例内容和演示运行都会明确标记。演示模式不会调用模型、联网搜索或执行生成代码。\n\n配置模型后，关闭新建任务里的演示模式即可发起真实运行。搜索需要 Tavily 配置，也可以提供允许域名下的资料链接。\n\n## 本地工作区\n\n本版本用于本机单用户使用。工单回复保存在本机，不会发送邮件或同步到 GitHub。', 'source': '手册', 'is_demo': False})
    specs = [
        ('run_example_research', 'research', '中文知识库检索方案对比', '比较关键词检索、向量检索与混合检索，关注中文长文档和可解释性。', '## 研究摘要\n\n> 这是一份示例报告，用于展示阅读与引用界面。没有执行外部检索或性能实验。\n\n为中文知识库设计检索方案时，可以分别测试关键词、向量和混合检索，并统一文档切分与评测问题。\n\n## 候选方案\n\n| 方案 | 适合验证的能力 | 需要关注的问题 |\n|---|---|---|\n| 关键词检索 | 专有名词、精确匹配 | 同义表达 |\n| 向量检索 | 自然语言、语义相似 | 数字与标识符 |\n| 混合检索 | 两种结果的互补性 | 排序与额外成本 |\n\n## 下一步实验\n\n准备一组独立测试问题，记录召回结果、响应时间与失败案例。所有数值应由实际运行产生。\n\n## 结论边界\n\n尚未运行实验，不能判断哪种方案效果最好。'),
        ('run_example_diagnosis', 'diagnosis', '排查检索结果为空的问题', '更新配置后部分中文查询没有返回结果，请检查配置与日志。', '## 诊断摘要\n\n> 示例报告：以下为待验证的排查步骤，不代表真实仓库中的已确认故障。\n\n## 待验证假设\n\n1. 数据导入完成，但查询使用了另一个集合。\n2. 相似度阈值过高，过滤了全部候选结果。\n3. 索引构建与查询使用了不同的嵌入模型。\n\n## 验证顺序\n\n先记录集合名称、文档数量、模型名称与过滤条件，再使用一条已知存在的文本进行查询。每次只改变一个条件。\n\n## 所需资料\n\n- 最小复现查询\n- 脱敏日志\n- 配置差异\n\n尚未获取真实代码或运行测试。'),
    ]
    for identifier, kind, title, prompt, report in specs:
        db.put('run', {'id': identifier, 'project_id': project['id'], 'title': title, 'kind': kind, 'prompt': prompt, 'status': 'completed', 'mode': 'demo', 'report': report, 'sources': [], 'plan': ['明确问题与约束', '收集资料', '检查证据', '整理报告'], 'tokens': 0, 'experiment': False, 'urls': [], 'ticket_id': None, 'is_seed': True})
    for index, (title, status, priority, customer) in enumerate([
        ('知识库更新后，检索结果为空', 'open', 'high', '林同学'),
        ('希望支持研究报告导出', 'in_progress', 'normal', '独立开发者'),
        ('如何为研究任务补充资料？', 'waiting', 'normal', '产品小组'),
    ]):
        db.put('ticket', {'id': f'ticket_example_{index}', 'project_id': project['id'], 'title': title, 'description': '这是一条示例工单。你可以修改状态、添加处理记录，或创建关联的 Agent 调查任务。', 'status': status, 'priority': priority, 'customer': customer, 'assignee': '未分配', 'comments': [], 'is_demo': True})
