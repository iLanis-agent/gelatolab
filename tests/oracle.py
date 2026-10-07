#!/usr/bin/env python3
"""Independent oracle for GelatoLab. Re-derives every number from the physical
constants (cryoscopic 1.86, molar masses, per-ingredient composition) with no
shared code. Writes tests/expected.json."""
import json, random, math

KF = 1.86
C = {
 'water':   {'fat': 0.0,   'msnf': 0.0,   'water': 1.0},
 'milk':    {'fat': 0.035, 'msnf': 0.087, 'water': 0.878},
 'cream':   {'fat': 0.35,  'msnf': 0.054, 'water': 0.596},
 'smp':     {'fat': 0.008, 'msnf': 0.97,  'water': 0.03},
 'yolk':    {'fat': 0.32,  'msnf': 0.0,   'water': 0.50},
 'sucrose': {'water': 0.0,  'pod': 1.00, 'frac': 1.00, 'mw': 342.30},
 'dextrose':{'water': 0.09, 'pod': 0.70, 'frac': 0.91, 'mw': 198.17},
 'glucose': {'water': 0.20, 'pod': 0.40, 'frac': 0.80, 'mw': 500.0},
 'honey':   {'water': 0.17, 'pod': 1.10, 'frac': 0.82, 'mw': 180.16},
}
LACT = 0.545; LACT_MW = 342.30; LACT_POD = 0.16
SUGARS = ['sucrose', 'dextrose', 'glucose', 'honey']

def analyze(raw, serve=-12.0, overrun=30.0):
    g = {k: float(raw.get(k, 0) or 0) for k in
         ['water','milk','cream','smp','yolk','sucrose','dextrose','glucose','honey','stabilizer']}
    W = sum(g.values())
    fat = g['milk']*C['milk']['fat'] + g['cream']*C['cream']['fat'] + g['smp']*C['smp']['fat'] + g['yolk']*C['yolk']['fat']
    msnf = g['milk']*C['milk']['msnf'] + g['cream']*C['cream']['msnf'] + g['smp']*C['smp']['msnf']
    water = (g['water']*C['water']['water'] + g['milk']*C['milk']['water'] + g['cream']*C['cream']['water'] + g['smp']*C['smp']['water']
             + g['yolk']*C['yolk']['water'] + g['glucose']*C['glucose']['water']
             + g['honey']*C['honey']['water'] + g['dextrose']*C['dextrose']['water'])
    lactose = msnf * LACT
    pod = sum(g[s]*C[s]['pod'] for s in SUGARS) + lactose*LACT_POD
    moles = sum(g[s]*C[s]['frac']/C[s]['mw'] for s in SUGARS) + lactose/LACT_MW
    dT = KF * moles / (water/1000.0)
    a = abs(serve)
    frozen = 0.0 if a <= dT else 1.0 - dT/a
    added = sum(g[s] for s in SUGARS)
    return {'W': W, 'fatPct': fat/W*100, 'msnfPct': msnf/W*100, 'addedSugarPct': added/W*100,
            'solidsPct': (W-water)/W*100, 'pod100': pod/W*100, 'pac100': sum(
                g[s]*C[s]['frac']*(LACT_MW/C[s]['mw']) for s in SUGARS)/W*100 + lactose/W*100,
            'dT': dT, 'frozenPct': frozen*100, 'scoops80': (W/1090.0)*(1+overrun/100)*1000/80}

def solve_fix(raw, P, Fpct, serve=-12.0):
    r = analyze(raw, serve)
    F = Fpct/100.0
    g = {k: float(raw.get(k, 0) or 0) for k in ['water','milk','cream','smp','yolk','sucrose','dextrose','glucose','honey','stabilizer']}
    pod = sum(g[s]*C[s]['pod'] for s in SUGARS) + (g['milk']*C['milk']['msnf']+g['cream']*C['cream']['msnf']+g['smp']*C['smp']['msnf'])*LACT*LACT_POD
    moles = sum(g[s]*C[s]['frac']/C[s]['mw'] for s in SUGARS) + (g['milk']*C['milk']['msnf']+g['cream']*C['cream']['msnf']+g['smp']*C['smp']['msnf'])*LACT/LACT_MW
    water = (g['water']*C['water']['water'] + g['milk']*C['milk']['water'] + g['cream']*C['cream']['water'] + g['smp']*C['smp']['water']
             + g['yolk']*C['yolk']['water'] + g['glucose']*C['glucose']['water']
             + g['honey']*C['honey']['water'] + g['dextrose']*C['dextrose']['water'])
    K = (1-F)*abs(serve)/KF
    a1, b1, c1 = 1 - P/100.0, C['dextrose']['pod'] - P/100.0, P/100.0*r['W'] - pod
    a2 = 1/C['sucrose']['mw']
    b2 = C['dextrose']['frac']/C['dextrose']['mw'] - K*C['dextrose']['water']/1000.0
    c2 = K*(water/1000.0) - moles
    det = a1*b2 - a2*b1
    x = (c1*b2 - c2*b1)/det
    y = (a1*c2 - a2*c1)/det
    return x, y

cases = [
 {'id': 'hand-classic-gelato', 'raw': {'milk': 600, 'cream': 250, 'sucrose': 120, 'dextrose': 40, 'yolk': 60}},
 {'id': 'hand-sorbet-no-dairy', 'raw': {'water': 700, 'sucrose': 200, 'dextrose': 50, 'glucose': 40, 'stabilizer': 3}},
 {'id': 'hand-honey-heavy', 'raw': {'milk': 500, 'cream': 200, 'smp': 30, 'honey': 90, 'sucrose': 60, 'yolk': 40}},
 {'id': 'hand-pure-sucrose', 'raw': {'milk': 1000, 'sucrose': 180}},
 {'id': 'hand-cryoscopic-ref', 'raw': {'milk': 0, 'cream': 0, 'sucrose': 100, 'glucose': 0, 'stabilizer': 0}},
]
# hand-cryoscopic-ref needs water; replace with explicit water-phase case below
cases[4] = {'id': 'hand-cryoscopic-ref', 'raw': {'milk': 500, 'sucrose': 100}}

rng = random.Random(20261007)
for i in range(18):
    raw = {'milk': rng.choice([0, 300, 450, 600, 750]),
           'cream': rng.choice([0, 100, 200, 250, 350]),
           'smp': rng.choice([0, 0, 20, 40, 60]),
           'yolk': rng.choice([0, 0, 40, 60, 90]),
           'sucrose': rng.randint(40, 200),
           'dextrose': rng.choice([0, 20, 40, 60, 80]),
           'glucose': rng.choice([0, 0, 30, 50]),
           'honey': rng.choice([0, 0, 0, 50, 90]),
           'stabilizer': rng.choice([0, 0, 2, 4])}
    if raw['milk'] + raw['cream'] < 200:
        raw['milk'] = 500 if i % 3 else 0
        if raw['milk'] == 0: raw['water'] = 650
    cases.append({'id': f'rand-{i:02d}', 'raw': raw})

serve_temps = [-10, -12, -12, -14]
out = []
for i, c in enumerate(cases):
    serve = serve_temps[i % len(serve_temps)]
    c['raw']['serveTemp'] = serve
    c['raw']['overrunPct'] = [0, 25, 35, 50][i % 4]
    r = analyze(c['raw'], serve, c['raw']['overrunPct'])
    e = {'analyze': {k: round(v, 6) for k, v in r.items()}}
    # fix targets: a few combos
    P = [18, 20, 22][i % 3]; F = [68, 73, 76][i % 3]
    x, y = solve_fix(c['raw'], P, F, serve)
    e['fix'] = {'P': P, 'F': F, 'x': round(x, 6), 'y': round(y, 6)}
    out.append({'id': c['id'], 'raw': c['raw'], 'expected': e})
with open('tests/expected.json', 'w') as f:
    json.dump(out, f, indent=1)
print('wrote', len(out), 'cases')
for o in out[:6]:
    a = o['expected']['analyze']
    print(o['id'], 'fat%', a['fatPct'], 'POD', a['pod100'], 'dT', a['dT'], 'frozen%', a['frozenPct'])
