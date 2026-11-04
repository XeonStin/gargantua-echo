#!/usr/bin/env python3
"""从耶鲁亮星星表(bsc5-all.json)生成 5.3f/assets/data/bright-stars.js
用法: python tools/gen_stars.py <bsc5-all.json 路径>
过滤 Vmag <= 5.2 的恒星,输出紧凑 ES 模块([raDeg, decDeg, Vmag, B-V])。
"""
import json
import math
import re
import sys

VMAG_MAX = 5.2

def parse_ra(s):
    m = re.match(r'(\d+)h\s+(\d+)m\s+([\d.]+)s', s or '')
    if not m:
        return None
    h, mi, sec = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return (h + mi / 60 + sec / 3600) * 15.0

def parse_dec(s):
    m = re.match(r'([+-])(\d+)°\s+(\d+)′\s+([\d.]+)″', s or '')
    if not m:
        return None
    sign = -1.0 if m.group(1) == '-' else 1.0
    d, mi, sec = int(m.group(2)), int(m.group(3)), float(m.group(4))
    return sign * (d + mi / 60 + sec / 3600)

def fnum(s):
    try:
        return float(str(s).replace('+', ''))
    except (TypeError, ValueError):
        return None

def main():
    src = sys.argv[1]
    with open(src, encoding='utf-8') as f:
        stars = json.load(f)
    out = []
    named = {}
    for s in stars:
        mag = fnum(s.get('Vmag'))
        if mag is None or mag > VMAG_MAX:
            continue
        ra = parse_ra(s.get('RA'))
        dec = parse_dec(s.get('Dec'))
        bv = fnum(s.get('B-V'))
        if ra is None or dec is None:
            continue
        if bv is None:
            bv = 0.65
        bv = max(-0.33, min(2.0, bv))
        out.append([round(ra, 3), round(dec, 3), round(mag, 2), round(bv, 2)])
        nm = s.get('Name')
        if nm and mag <= 1.75:
            named[nm] = len(out) - 1
    body = ',\n'.join('[' + ','.join(str(x) for x in st) + ']' for st in out)
    names = ',\n'.join(f'  {json.dumps(k)}: {v}' for k, v in sorted(named.items(), key=lambda kv: kv[1]))
    js = f'''// GARGANTUA — 真实星空:耶鲁亮星星表子集(由 tools/gen_stars.py 生成)
// 来源: Yale Bright Star Catalogue (bsc5-all.json),Vmag <= {VMAG_MAX},共 {len(out)} 颗。
// 每项: [赤经°, 赤纬°, 视星等, B−V 色指数]
export const BRIGHT_STARS = [
{body}
];

// 亮星(Vmag <= 1.75)的拜耳名 → 星表索引,供标注/导览使用
export const NAMED_STARS = {{
{names}
}};
'''
    dst = 'assets/data/bright-stars.js'
    import os
    os.makedirs('assets/data', exist_ok=True)
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    print(f'wrote {dst}: {len(out)} stars, {len(named)} named, {os.path.getsize(dst)} bytes')

if __name__ == '__main__':
    main()
