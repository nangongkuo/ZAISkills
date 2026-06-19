#!/usr/bin/env python3
"""
run_frida.py - Python frida runner, 替代不稳定的 `frida -U -N -l script.js`

解决 frida REPL 后台 stdout 写不出的问题，也支持 spawn 模式

用法:
    python3 run_frida.py [--spawn] <pkg> <script_or_dir> [more_scripts...]

参数:
    --spawn          spawn 模式（杀掉旧进程并冷启动），默认 attach
    --runtime v8     frida runtime，默认 v8（更稳，支持 ES6 const/let）
    --duration N     N 秒后自动退出，默认 0（永不退出，需要 ctrl-c）
    --out FILE       输出到文件（默认 stdout）

示例:
    # attach 已运行的淘宝，加载多个脚本（先 _common.js 再 trace_*.js）
    python3 run_frida.py com.taobao.taobao scripts/frida/tb/_common.js scripts/frida/trace_mtop_v2.js --out tb.log

    # spawn 淘宝，60s 后自动退出
    python3 run_frida.py --spawn --duration 60 com.taobao.taobao scripts/frida/trace_mtop_v2.js
"""

import sys, os, time, argparse
import frida


def main():
    p = argparse.ArgumentParser(formatter_class=argparse.RawDescriptionHelpFormatter, description=__doc__)
    p.add_argument('--spawn', action='store_true', help='spawn 模式（冷启）')
    p.add_argument('--runtime', default='v8', choices=['v8', 'qjs'])
    p.add_argument('--duration', type=int, default=0, help='N 秒后退出')
    p.add_argument('--out', default='-', help='输出文件，- 为 stdout')
    p.add_argument('pkg', help='目标包名')
    p.add_argument('scripts', nargs='+', help='frida JS 脚本路径，按顺序合并加载')
    args = p.parse_args()

    out = sys.stdout if args.out == '-' else open(args.out, 'w', encoding='utf-8', buffering=1)

    def emit(msg):
        print(msg, file=out, flush=True)

    device = frida.get_usb_device(timeout=10)
    emit(f'[run_frida] device={device.id}')

    # 合并所有脚本
    bodies = []
    for sp in args.scripts:
        if not os.path.exists(sp):
            print(f'[err] script not found: {sp}', file=sys.stderr)
            sys.exit(2)
        bodies.append(f'// === {sp} ===')
        bodies.append(open(sp, 'r', encoding='utf-8').read())
    merged = '\n'.join(bodies)

    pid = None
    if args.spawn:
        emit(f'[run_frida] spawning {args.pkg}')
        pid = device.spawn([args.pkg])
        session = device.attach(pid)
    else:
        try:
            proc = device.get_process(args.pkg)
        except frida.ProcessNotFoundError:
            print(f'[err] process not running: {args.pkg} (use --spawn?)', file=sys.stderr)
            sys.exit(2)
        emit(f'[run_frida] attached to {args.pkg} pid={proc.pid}')
        session = device.attach(proc.pid)

    script = session.create_script(merged, runtime=args.runtime)

    def on_message(msg, _data):
        t = msg.get('type')
        if t == 'send':
            emit(f'[send] {msg.get("payload")}')
        elif t == 'log':
            emit(msg.get('payload', ''))
        elif t == 'error':
            emit(f'[err] {msg.get("description")}\n{msg.get("stack", "")}')

    script.on('message', on_message)
    script.load()
    if args.spawn:
        device.resume(pid)
    emit('[run_frida] script loaded, running')

    try:
        if args.duration > 0:
            time.sleep(args.duration)
            emit(f'[run_frida] duration {args.duration}s reached, exiting')
        else:
            while True:
                time.sleep(60)
    except KeyboardInterrupt:
        emit('[run_frida] interrupted')
    finally:
        try:
            session.detach()
        except Exception:
            pass
        if out is not sys.stdout:
            out.close()


if __name__ == '__main__':
    main()
