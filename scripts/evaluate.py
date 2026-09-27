"""Small workflow evaluation runner; quality scores require human annotation."""
import argparse
import json
import re
import time
from pathlib import Path
import httpx

parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['demo', 'live'], default='demo')
parser.add_argument('--url', default='http://127.0.0.1:8120')
parser.add_argument('--limit', type=int, default=3)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
tasks = [json.loads(line) for line in (root / 'evals/tasks.jsonl').read_text('utf-8').splitlines() if line.strip()][:args.limit]
results = []
with httpx.Client(base_url=args.url, headers={'X-Sakuya-Client': 'workspace'}, trust_env=False, timeout=20) as client:
    workspace = client.get('/api/workspace').json()
    if args.mode == 'live' and not workspace['settings']['model_configured']:
        raise SystemExit('请先配置模型连接。')
    for task in tasks:
        started = time.monotonic()
        response = client.post('/api/runs', json={'title': f"评测 · {task['title']}", 'prompt': task['prompt'], 'kind': task['kind'], 'project_id': workspace['projects'][0]['id'], 'mode': args.mode, 'urls': task.get('urls', []), 'experiment': False})
        response.raise_for_status()
        run = response.json()
        while run['status'] in {'queued', 'running'} and time.monotonic() - started < 360:
            time.sleep(1)
            run = client.get('/api/runs/' + run['id']).json()
        report = run.get('report', '')
        refs = [int(i) for i in re.findall(r'\[(\d+)\]', report)]
        result = {'task': task['id'], 'run_id': run['id'], 'mode': args.mode, 'status': run['status'], 'duration_seconds': round(time.monotonic() - started, 2), 'tokens': run.get('tokens', 0), 'source_count': len(run.get('sources', [])), 'has_report': bool(report), 'invalid_citation_numbers': sorted({n for n in refs if not 1 <= n <= len(run.get('sources', []))}), 'human_review_required': task['review'], 'quality_score': None}
        results.append(result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
output = root / '.data' / 'evaluations'
output.mkdir(parents=True, exist_ok=True)
path = output / f'{args.mode}-{time.strftime("%Y%m%d-%H%M%S")}.json'
path.write_text(json.dumps(results, ensure_ascii=False, indent=2), 'utf-8')
print(f'已保存流程评测结果：{path}')
