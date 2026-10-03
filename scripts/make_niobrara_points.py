"""Synthetic core point data for Mattson 12-32 (Niobrara example well), for testing point CSV import and plotting.

Writes three lab-style CSVs to samples/niobrara/, each keyed to the well a different way:
  Mattson_12-32_core_RCA.csv    rock quality (tight-rock analysis): well name + API
  Mattson_12-32_geomech.csv     triaxial and ultrasonic geomechanics: 10-digit API only
  Mattson_12-32_XRD.csv         XRD mineralogy: well name only

Values are synthetic but driven by the well's own GR and density logs, so they track the curves: low-GR chalk
benches get more calcite, porosity and stiffness; marls get more clay, TOC and water. Core depths are on log depth
(no core-to-log shift). Run: python3 scripts/make_niobrara_points.py
"""
import csv
import os

import numpy as np

LAS = 'app/data/niobrara/2120933C.las'
OUT = 'samples/niobrara'
WELL, API12, API10 = 'Mattson 12-32', '49-021-20933-0000', '4902120933'
# Picks from app/data/niobrara/tops.csv
SHARON, NIOB, LOWER, CARLILE = 6475.0, 6548.5, 6869.0, 7277.0
rng = np.random.default_rng(20933)


def read_las(path):
    text = open(path).read().split('~A')[1].splitlines()
    cols = text[0].split()
    d = np.array([[float(x) for x in l.split()] for l in text[1:] if l.strip()])
    d[d == -999.25] = np.nan
    return dict(zip(cols, d.T))


L = read_las(LAS)


def log_at(md, mnem, half=1.0):
    """Log value averaged over +/- half ft (a 1-in plug sees less than the tool; this smooths the tool noise)."""
    m = np.abs(L['DEPT'] - md) <= half
    return float(np.nanmean(L[mnem][m]))


def rock(md):
    """Mineral and pore model at a depth from GR and RHOZ."""
    gr, rhob = log_at(md, 'GR'), log_at(md, 'RHOZ')
    shale = md < NIOB or md >= CARLILE
    vcl = np.clip(0.08 + (gr - 50) / 170 * 0.37, 0.06, 0.62) + rng.normal(0, 0.025)
    if shale:
        vcl = max(vcl, 0.45)
    vcl = float(np.clip(vcl, 0.05, 0.65))
    qtz = float(np.clip(rng.normal(0.10 + (0.12 if shale else 0.0), 0.025), 0.04, 0.30))
    pyr = float(np.clip(rng.normal(0.012 + 0.03 * vcl, 0.004), 0.003, 0.05))
    dol = float(np.clip(rng.normal(0.012, 0.008), 0.0, 0.04))
    kfs = float(np.clip(rng.normal(0.008 + 0.01 * shale, 0.004), 0.0, 0.03))
    plg = float(np.clip(rng.normal(0.02 + 0.02 * shale, 0.006), 0.005, 0.06))
    cal = 1 - vcl - qtz - pyr - dol - kfs - plg
    if cal < 0.02:  # shales: take the excess from clay
        vcl += cal - 0.02
        cal = 0.02
    # TOC: organic-rich marls and the Sharon Springs; lean chalks and Carlile
    if md < NIOB:
        toc = rng.normal(3.6, 0.6)
    elif md >= CARLILE:
        toc = rng.normal(1.0, 0.3)
    else:
        toc = 0.6 + 9.0 * vcl + rng.normal(0, 0.35)
    toc = float(np.clip(toc, 0.3, 7.0))
    # Grain density with kerogen (about 1.2 x TOC wt% as kerogen, density 1.3)
    rho_min = 1 / (cal / 2.71 + qtz / 2.65 + vcl / 2.75 + pyr / 5.0 + dol / 2.87 + kfs / 2.56 + plg / 2.68)
    wk = 1.2 * toc / 100
    rhog = 1 / ((1 - wk) / rho_min + wk / 1.3)
    phi = (rhog - rhob) / (rhog - 1.05)
    if shale:  # density porosity reads high in shale (clay-bound water); lab porosity on dried samples is lower
        phi *= 0.6
    phi = float(np.clip(phi + rng.normal(0, 0.006), 0.015, 0.14))
    return dict(md=md, gr=gr, rhob=rhob, vcl=vcl, qtz=qtz, pyr=pyr, dol=dol, kfs=kfs, plg=plg, cal=cal, toc=toc,
                rhog=rhog, phi=phi, shale=shale)


def facies(r):
    if r['md'] < NIOB:
        return 'Calcareous shale'
    if r['md'] >= CARLILE:
        return 'Shale'
    return 'Chalk' if r['cal'] >= 0.70 else 'Marly chalk' if r['cal'] >= 0.55 else 'Marl'


def depths(top, base, step, jitter):
    d = np.arange(top, base, step) + rng.uniform(-jitter, jitter, len(np.arange(top, base, step)))
    return [round(float(x), 1) for x in d]


def write(name, header, rows):
    os.makedirs(OUT, exist_ok=True)
    with open(f'{OUT}/{name}', 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(header)
        w.writerows(rows)
    print(f'wrote {OUT}/{name} ({len(rows)} rows)')


# 1. Rock quality: GRI/tight-rock analysis on crushed samples, about every 5 ft through the cored interval.
rows = []
for k, md in enumerate(depths(6530, 7300, 5, 1.2)):
    r = rock(md)
    phi = r['phi'] * 100
    # Crushed-rock (pulse-decay) matrix permeability, tens to hundreds of nanodarcies
    perm = 10 ** (-3.7 + 0.11 * (phi - 8) - 0.9 * r['vcl'] + rng.normal(0, 0.25))
    sw = float(np.clip(28 + 70 * r['vcl'] - 1.2 * (phi - 8) + rng.normal(0, 5), 12, 95))
    so = float(np.clip((100 - sw) * rng.uniform(0.75, 0.95), 0, 100 - sw))
    bulk = r['rhog'] * (1 - r['phi']) + r['phi'] * (sw / 100 * 1.05 + (1 - sw / 100) * 0.75)
    row = [WELL, API12, f'{md:.1f}', f'RCA-{k + 1:03d}', facies(r), f'{phi:.2f}', f'{perm:.2e}', f'{r["rhog"]:.3f}',
           f'{bulk:.3f}', f'{sw:.1f}', f'{so:.1f}', f'{r["toc"]:.2f}']
    # Lab gaps: no permeability on a few fractured or broken samples
    if k in (17, 61, 102):
        row[6] = ''
    rows.append(row)
write('Mattson_12-32_core_RCA.csv',
      ['well', 'api', 'md_ft', 'sample_id', 'lithofacies', 'porosity (%)', 'perm (mD)', 'grain_den (g/cc)',
       'bulk_den (g/cc)', 'sw (%)', 'so (%)', 'toc (wt%)'], rows)

# 2. Geomechanics: vertical plugs, triaxial at in-situ effective stress plus ultrasonic velocities, about every 20 ft.
rows = []
FT, PSI = 0.3048, 6894.757
for k, md in enumerate(depths(6545, 7300, 20, 3)):
    r = rock(md)
    vp = 17000 * (1 - r['phi']) ** 2.3 * (1 - 0.40 * r['vcl']) * rng.normal(1, 0.02)
    vs = vp / (1.72 + 0.35 * r['vcl'] + rng.normal(0, 0.02))
    rho = r['rhob'] * 1000
    g = rho * (vs * FT) ** 2
    pr_d = (vp ** 2 - 2 * vs ** 2) / (2 * (vp ** 2 - vs ** 2))
    ym_d = 2 * g * (1 + pr_d) / PSI / 1e6
    ym_s = ym_d * np.clip(rng.normal(0.72 - 0.25 * r['vcl'], 0.04), 0.4, 0.9)
    pr_s = pr_d * rng.normal(0.92, 0.04)
    ucs = 3100 * ym_s * rng.normal(1, 0.08)
    rows.append([API10, f'{md:.1f}', f'GM-{k + 1:02d}', facies(r), f'{r["rhob"]:.3f}', f'{vp:.0f}', f'{vs:.0f}',
                 f'{ym_d:.2f}', f'{pr_d:.3f}', f'{ym_s:.2f}', f'{pr_s:.3f}', f'{ucs:.0f}'])
write('Mattson_12-32_geomech.csv',
      ['api', 'md_ft', 'sample_id', 'lithofacies', 'plug_bulk_den (g/cc)', 'vp (ft/s)', 'vs (ft/s)', 'ym_dyn (Mpsi)',
       'pr_dyn', 'ym_static (Mpsi)', 'pr_static', 'ucs (psi)'], rows)

# 3. XRD mineralogy (weight %), about every 10 ft. Mixed-layer illite/smectite dominates Niobrara clays.
rows = []
for k, md in enumerate(depths(6530, 7300, 10, 2)):
    r = rock(md)
    cl = r['vcl']
    split = rng.dirichlet([10, 5, 1.5, 1]) if not r['shale'] else rng.dirichlet([9, 6, 3, 1.5])
    ism, ilm, kao, chl = (cl * s for s in split)
    m = [r['qtz'], r['kfs'], r['plg'], r['cal'], r['dol'], r['pyr'], ism, ilm, kao, chl]
    pct = [round(100 * x / sum(m), 1) for x in m]
    pct[3] = round(100 - sum(pct) + pct[3], 1)  # close to 100 on calcite
    rows.append([WELL, f'{md:.1f}', f'XRD-{k + 1:03d}', facies(r)] + [f'{x:.1f}' for x in pct]
                + [f'{sum(pct[6:]):.1f}'])
write('Mattson_12-32_XRD.csv',
      ['well', 'md_ft', 'sample_id', 'lithofacies', 'quartz (wt%)', 'k_feldspar (wt%)', 'plagioclase (wt%)',
       'calcite (wt%)', 'dolomite (wt%)', 'pyrite (wt%)', 'illite_smectite (wt%)', 'illite_mica (wt%)',
       'kaolinite (wt%)', 'chlorite (wt%)', 'total_clay (wt%)'], rows)
