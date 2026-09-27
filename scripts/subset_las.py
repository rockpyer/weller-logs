"""Cut public LAS files down to a depth window and a curve list, keeping headers verbatim.

Used to build app/data/niobrara from WOGCC logs redistributed in
github.com/jessepisel/5minutesofpython (public domain, Unlicense).
Header lines are copied unchanged so the app's parser meets real-world quirks.
Usage: python3 scripts/subset_las.py SRC DST TOP BASE CURVE [CURVE ...]
"""
import sys

def subset(src, dst, top, base, keep):
    lines = open(src, errors='replace').read().splitlines()
    out, sec, curves, cidx = [], '', [], []
    for line in lines:
        s = line.strip()
        if s.startswith('~'):
            sec = s[1:2].upper()
            if sec == 'A':
                cidx = [i for i, c in enumerate(curves) if i == 0 or c.upper() in keep]
                out.append('~A  ' + ' '.join(curves[i] for i in cidx))
                continue
            out.append(line); continue
        if sec == 'C' and s and not s.startswith('#'):
            mn = s.split('.')[0].strip()
            curves.append(mn)
            if len(curves) == 1 or mn.upper() in keep: out.append(line)
            continue
        if sec == 'A':
            t = s.split()
            if not t: continue
            d = float(t[0])
            if top <= d <= base: out.append(' '.join(t[i] for i in cidx if i < len(t)))
            continue
        if sec == 'W' and s.split('.')[0].strip().upper() in ('STRT', 'STOP'):
            out.append(line + '   # original; data subset to %g-%g' % (top, base)); continue
        out.append(line)
    open(dst, 'w').write('\n'.join(out) + '\n')

if __name__ == '__main__':
    src, dst, top, base = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
    subset(src, dst, top, base, {c.upper() for c in sys.argv[5:]})
