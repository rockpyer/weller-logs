"""Rule-based first-pass tops for the Denver Basin demo wells. Interpretive, for demonstration.

Each marker is found inside a search window by a simple, repeatable log response:
  Sharon Springs  first depth where 10-ft mean GR exceeds 150 API (organic shale ramp)
  Niobrara        largest 10-ft upward step in density within 90 ft below Sharon Springs
  Lower Niobrara  largest 10-ft drop in PE within 250-400 ft below the Niobrara top
  Carlile         largest 10-ft drop in log10 deep resistivity, 600-760 ft below Niobrara top
  Greenhorn       largest 10-ft upward step in density within 100-190 ft below Carlile
  D Sandstone     first depth below Greenhorn + 60 ft where 4-ft mean GR < 60 API
Writes app/data/niobrara/tops.csv (well, api, top, md_ft, source).
The Weld County horizontal (GR only) is picked on GR vs TVD from its survey: Sharon Springs where the 10-ft mean GR
first exceeds 150 API below 5300 ft TVD, Niobrara where it falls back below 150 API at least 20 ft deeper.
"""
import numpy as np, glob, re, csv

def read(f):
    L = open(f).read().splitlines(); i = [k for k, l in enumerate(L) if l.startswith('~A')][0]
    names = L[i].split()[1:]
    d = np.array([[float(x) for x in l.split()] for l in L[i + 1:] if l.strip()]); d[d == -999.25] = np.nan
    head = '\n'.join(L[:i])
    well = re.search(r'^\s*WELL\s*\.\s*(?:WELL:)?\s*(.*?)\s*(?::WELL)?\s*$', head, re.M).group(1).strip()
    api = re.search(r'^\s*API\s*\..*?(\d[\d-]+)', head, re.M).group(1)
    return dict(zip(names, d.T)), well, api

def mean(x, n):  # centered moving mean, nan-aware
    k = np.ones(n); v = np.where(np.isnan(x), 0, x); c = np.convolve(~np.isnan(x), k, 'same'); return np.convolve(v, k, 'same') / np.maximum(c, 1)

def step(x, d, lo, hi, n, sign):  # depth of the largest signed step between n-sample windows above and below
    best, at = -np.inf, None
    for i in np.where((d >= lo) & (d <= hi))[0]:
        if i - n < 0 or i + n >= len(x): continue
        s = sign * (np.nanmean(x[i:i + n]) - np.nanmean(x[i - n:i]))
        if s > best: best, at = s, d[i]
    return at

rows = []
for f in sorted(glob.glob('app/data/niobrara/21*.las')):   # the seven Laramie County verticals
    c, well, api = read(f); d = c['DEPT']; step_ft = d[1] - d[0]; n10 = int(round(10 / step_ft)); n4 = int(round(4 / step_ft))
    gr10, gr4 = mean(c['GR'], n10), mean(c['GR'], n4)
    t = {}
    t['Sharon Springs'] = d[np.where((d > 6300) & (gr10 > 150))[0][0]]
    t['Niobrara'] = step(c['RHOZ'], d, t['Sharon Springs'], t['Sharon Springs'] + 90, n10, +1)
    t['Lower Niobrara'] = step(c['PEFZ'], d, t['Niobrara'] + 250, t['Niobrara'] + 400, n10, -1)
    t['Carlile'] = step(np.log10(c['AT90']), d, t['Niobrara'] + 600, t['Niobrara'] + 760, n10, -1)
    t['Greenhorn'] = step(c['RHOZ'], d, t['Carlile'] + 100, t['Carlile'] + 190, n10, +1)
    i = np.where((d > t['Greenhorn'] + 60) & (gr4 < 60))[0]; t['D Sandstone'] = d[i[0]] if len(i) else None
    for k, v in t.items():
        if v is not None: rows.append([well, api, k, round(float(v), 1), 'Weller rule-based pick (interpretive)'])
    print(f"{well:22s}", '  '.join(f"{k.split()[0][:6]} {v:.0f}" for k, v in t.items() if v))
# Weld County horizontal: GR only, picked against TVD from the survey carried in its ~Other section.
L = open('app/data/niobrara/400709586.las').read().splitlines()
k0 = [k for k, l in enumerate(L) if l.strip().startswith('~Other')][0]; sv = []
for l in L[k0 + 1:]:
    t = l.split()
    if len(t) >= 5:
        try: sv.append([float(x) for x in t[:5]])
        except ValueError: break
sv = np.array(sv); well, api = 'Horsetail 02D-00204', ''
k1 = [k for k, l in enumerate(L) if l.startswith('~A')][0]
d = np.array([[float(x) for x in l.split()] for l in L[k1 + 1:] if l.strip() and not l.startswith('#')]); d[d <= -999] = np.nan
md, tvd = d[:, 0], np.interp(d[:, 0], sv[:, 1], sv[:, 4]); g10 = mean(d[:, 1], 10)
ss = md[np.where((tvd > 5300) & (g10 > 150))[0][0]]; nb = md[np.where((md > ss + 20) & (g10 < 150))[0][0]]
src = 'Weller rule-based pick on GR vs TVD (interpretive; GR only)'
rows += [[well, api, 'Sharon Springs', float(ss), src], [well, api, 'Niobrara', float(nb), src]]
print(f"{well:22s} Sharon {ss:.0f} MD  Niobra {nb:.0f} MD (TVD {np.interp(ss, sv[:,1], sv[:,4]):.0f}, {np.interp(nb, sv[:,1], sv[:,4]):.0f})")
with open('app/data/niobrara/tops.csv', 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['well', 'api', 'top', 'md_ft', 'source']); w.writerows(rows)
