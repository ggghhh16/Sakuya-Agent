"""Persistent local worker. Queued work survives API and worker restarts."""
import threading
import time
import os
from contextvars import copy_context
from datetime import datetime, timezone
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from . import db
from .graph import build, safe_error


def recover_stale():
    for run in db.all_items('run'):
        if run['status'] == 'running':
            heartbeat = datetime.fromisoformat(run.get('heartbeat', run['updated_at']))
            if (datetime.now(timezone.utc) - heartbeat).total_seconds() > 45:
                try:
                    db.transition_run(run['id'], {'running'}, {'status': 'queued'})
                    db.event(run['id'], 'recovery', '检测到执行进程中断，已重新排队；将从最近的检查点继续')
                except ValueError:
                    pass


def execute(run):
    stop = threading.Event()
    def pulse():
        while not stop.wait(5):
            db.patch(run['id'], {'heartbeat': db.now()})
            (db.DATA / 'worker.pulse').touch()
    context = copy_context()
    thread = threading.Thread(target=context.run, args=(pulse,), daemon=True)
    thread.start()
    try:
        with SqliteSaver.from_conn_string(str(db.data_dir() / 'checkpoints.sqlite')) as saver:
            graph = build(saver)
            config = {'configurable': {'thread_id': run['id']}, 'recursion_limit': 24}
            snapshot = graph.get_state(config)
            if snapshot.values:
                payload = Command(resume=run['resume_decision']) if run.get('resume_decision') else None
            else:
                payload = {'run_id': run['id'], 'tokens': 0}
            result = graph.invoke(payload, config)
            current = db.get(run['id'])
            if current['status'] == 'cancelled':
                return
            if '__interrupt__' in result:
                db.transition_run(run['id'], {'running'}, {'status': 'waiting', 'approval': result['__interrupt__'][0].value, 'resume_decision': None})
                db.event(run['id'], 'approval', '操作已准备好，等待你批准或拒绝')
            else:
                db.transition_run(run['id'], {'running'}, {'status': 'completed', 'report': result.get('report', ''), 'tokens': result.get('tokens', 0), 'resume_decision': None, 'error': None})
                db.event(run['id'], 'completed', '报告已生成，来源与执行记录已保存')
    except InterruptedError:
        pass
    except Exception as exc:
        if db.get(run['id'])['status'] != 'cancelled':
            db.patch(run['id'], {'status': 'failed', 'error': safe_error(exc)})
            db.event(run['id'], 'failed', safe_error(exc))
    finally:
        stop.set()
        thread.join(timeout=1)


def work_once():
    worked = False
    # One task per workspace per pass so a busy account cannot starve the others.
    for owner in db.workspace_owners():
        with db.workspace(owner):
            recover_stale()
            run = db.claim()
            if run:
                worked = True
                execute(run)
    return worked


def main():
    db.init()
    # Keep a single worker per local workspace; OS releases the lock on crash.
    lock = (db.DATA / 'worker.lock').open('a+b')
    lock.seek(0)
    if not lock.read(1):
        lock.write(b'1')
        lock.flush()
    lock.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit('该工作区已有 Worker 正在运行，请先停止重复的启动进程。')
    print('Sakuya worker ready', flush=True)
    while True:
        (db.DATA / 'worker.pulse').touch()
        if not work_once():
            time.sleep(.7)


if __name__ == '__main__':
    main()
