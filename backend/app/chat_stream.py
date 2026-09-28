"""Persist throttled reply snapshots for reconnectable SSE delivery."""
import time
from . import db


class ReplyStream:
    def __init__(self, run_id):
        self.run_id = run_id
        self.text = ''
        self.saved = None
        self.updated = 0

    def check(self):
        run = db.get(self.run_id, 'run')
        if not run or run['status'] != 'running':
            raise InterruptedError('任务已停止')

    def reset(self):
        self.text = ''
        self.flush()

    def __call__(self, delta):
        self.check()
        self.text += delta
        if not self.saved or time.monotonic() - self.updated >= .08:
            self.flush()

    def flush(self):
        self.check()
        if self.text != self.saved:
            if not db.transition_run(self.run_id, {'running'}, {'partial_report': self.text}):
                raise InterruptedError('任务已停止')
            self.saved = self.text
            self.updated = time.monotonic()
