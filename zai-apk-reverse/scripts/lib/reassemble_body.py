#!/usr/bin/env python3
"""
reassemble_body.py - 把 frida 分段 dump 的字节流拼回完整 JSON/文本

格式契约（lib/_common.js 的 dumpBytes/dumpString）:
    [<prefix> +<ms>ms] <label>[<start>..<end>]: <chunk>

也兼容旧格式（用 . 而非 .. 分隔）:
    [<prefix> +<ms>ms] <label>[<start>.<end>]: <chunk>

用法:
    # 列出所有 label
    python3 reassemble_body.py <log_file>

    # 提取某个 label 的完整 body
    python3 reassemble_body.py <log_file> <label>
    例: python3 reassemble_body.py mtop.log "RESP#3.body"

    # 把所有 label 都导出到 <out_dir>/
    python3 reassemble_body.py <log_file> --all <out_dir>

    # 统计 body 数量（用于 dynamic.sh 校验）
    python3 reassemble_body.py <log_file> --count
"""

import re
import sys
import os
import json
from collections import defaultdict

# 兼容两种格式:
# 标准格式: [prefix +Nms] label[0..3500]: chunk
# 旧格式:   [prefix +Nms] label[0.3500]: chunk
PATTERN_NEW = re.compile(
    r'^\[[^\]]+\]\s*'       # [prefix +Nms]
    r'(\S+?)'               # label (group 1)
    r'\[(\d+)\.\.(\d+)\]'  # [start..end] (group 2,3)
    r':\s*(.*)$'            # : chunk (group 4)
)

PATTERN_OLD = re.compile(
    r'^\[[^\]]+\]\s*'
    r'(\S+?)'
    r'\[(\d+)\.(\d+)\]'    # [start.end] 旧格式
    r':\s*(.*)$'
)


def parse_log(path):
    """returns dict: label -> list of (start, end, chunk)"""
    bodies = defaultdict(list)
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for ln in f:
            ln = ln.rstrip('\n')
            # 优先匹配标准格式
            m = PATTERN_NEW.search(ln)
            if not m:
                # 回退旧格式
                m = PATTERN_OLD.search(ln)
            if m:
                label = m.group(1).strip()
                start = int(m.group(2))
                end = int(m.group(3))
                chunk = m.group(4)
                bodies[label].append((start, end, chunk))
    return bodies


def reassemble(bodies, label):
    """Reassemble chunks for a given label. Returns (text, is_truncated)."""
    if label not in bodies:
        return None, False
    chunks = sorted(bodies[label], key=lambda x: x[0])
    out = []
    truncated = False

    for i, (start, end, chunk) in enumerate(chunks):
        out.append(chunk)
        # 检测间隙：如果当前 end 与 next start 不连续
        if i < len(chunks) - 1:
            next_start = chunks[i + 1][0]
            if next_start != end:
                truncated = True

    text = ''.join(out)
    return text, truncated


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    log = args[0]
    if not os.path.exists(log):
        print(f"[err] log not found: {log}", file=sys.stderr)
        sys.exit(2)
    bodies = parse_log(log)

    # --count: 只输出 body 数量
    if len(args) >= 2 and args[1] == '--count':
        print(len(bodies))
        return

    if len(args) == 1:
        # 列出所有 label
        print(f"# {len(bodies)} labels in {log}")
        for label in sorted(bodies.keys()):
            chunks = bodies[label]
            total = sum(len(c[2]) for c in chunks)
            print(f"  {label:<48s} chunks={len(chunks):3d}  total={total:>8d} chars")
        return

    if args[1] == '--all':
        out_dir = args[2] if len(args) > 2 else os.path.join(os.path.dirname(log) or '.', 'bodies')
        os.makedirs(out_dir, exist_ok=True)
        count = 0
        for label in bodies.keys():
            text, truncated = reassemble(bodies, label)
            if not text:
                continue
            safe = re.sub(r'[^a-zA-Z0-9._#-]', '_', label)
            fp = os.path.join(out_dir, safe + '.txt')
            with open(fp, 'w', encoding='utf-8') as f:
                if truncated:
                    f.write('[TRUNCATED - 完整 body 可能因 frida 超时未分段输出]\n\n')
                f.write(text)
            status = 'TRUNCATED' if truncated else 'OK'
            print(f"  {label} -> {fp} ({len(text)} chars) [{status}]")
            count += 1
        print(f"\n# Reassembled {count} bodies -> {out_dir}")
        return

    # 提取单个 label
    label = args[1]
    text, truncated = reassemble(bodies, label)
    if text is None:
        print(f"[err] label not found: {label}", file=sys.stderr)
        print("available labels:", ', '.join(sorted(bodies.keys())), file=sys.stderr)
        sys.exit(3)
    if truncated:
        print("[TRUNCATED]", file=sys.stderr)
    # 尝试 JSON 美化输出
    try:
        j = json.loads(text)
        sys.stdout.write(json.dumps(j, ensure_ascii=False, indent=2))
        sys.stdout.write('\n')
    except Exception:
        sys.stdout.write(text)
        sys.stdout.write('\n')


if __name__ == '__main__':
    main()
