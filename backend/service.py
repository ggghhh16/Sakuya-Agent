"""Packaged local API and worker. No development server or Node installation."""
import argparse
import os
import sys
import threading


def main():
    parser = argparse.ArgumentParser()
    from app.edition import IS_CLIENT
    parser.add_argument('--port', type=int, default=8121 if IS_CLIENT else 8120)
    parser.add_argument('--managed', action='store_true')
    parser.add_argument('--admin-email', help='创建或提升管理员后退出，不启动服务')
    args = parser.parse_args()
    os.environ['SAKUYA_PORT'] = str(args.port)
    if not os.getenv('SAKUYA_DATA_DIR'):
        from pathlib import Path
        os.environ['SAKUYA_DATA_DIR'] = str(Path(os.getenv('LOCALAPPDATA', str(Path.home()))) / ('Sakuya Client' if IS_CLIENT else 'Sakuya Agent') / 'workspace')
    if args.admin_email:
        if IS_CLIENT:
            parser.error('Client has no accounts')
        from app.auth import configure_admin
        configure_admin(args.admin_email)
        return
    if args.managed:
        # The launcher's pipe is closed even if Electron crashes. Do not orphan
        # a service which continues occupying the port after its owner exits.
        def watch_owner():
            sys.stdin.buffer.read()
            os._exit(0)
        threading.Thread(target=watch_owner, daemon=True).start()
    from app import db
    from app.seed import seed
    from app.worker import main as worker_main
    from app.main import app
    import uvicorn
    db.init()
    seed()
    def worker():
        try:
            worker_main()
        except BaseException:
            # A healthy API without an executor must not appear ready.
            os._exit(2)
    threading.Thread(target=worker, daemon=True, name='sakuya-worker').start()
    uvicorn.run(app, host='127.0.0.1', port=args.port, loop='asyncio', http='h11', ws='none', access_log=False, proxy_headers=False)


if __name__ == '__main__':
    main()
