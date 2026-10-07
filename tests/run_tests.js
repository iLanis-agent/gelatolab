/* GelatoLab tests: oracle cases (independent python physics), fix-solver
   roundtrips, band verdicts, validation, escaping. Run: node tests/run_tests.js */
'use strict';
const G = require('../engine.js');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.error('FAIL:', msg); } }
function close(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + ` (${a} vs ${b})`); }
function throwsWith(fn, needle, msg) {
  try { fn(); failed++; console.error('FAIL (no throw):', msg); }
  catch (e) { ok(e.message.includes(needle), msg + ` (threw "${e.message}")`); }
}

// ---------- 1. Oracle cases: analyze + fix ----------
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8'));
const FIELDS = ['W','fatPct','msnfPct','addedSugarPct','solidsPct','pod100','pac100','dT','frozenPct','scoops80'];
for (const c of cases) {
  const r = G.analyze(c.raw);
  for (const f of FIELDS) close(r[f], c.expected.analyze[f], 1e-4, `${c.id}: analyze.${f}`);
  const fx = G.fix(c.raw, c.expected.fix.P, c.expected.fix.F);
  close(fx.sucroseDelta, c.expected.fix.x, 1e-4, `${c.id}: fix.x`);
  close(fx.dextroseDelta, c.expected.fix.y, 1e-4, `${c.id}: fix.y`);
  // roundtrip when the fix stays inside the available sugars
  const r0 = G.analyze(c.raw);
  const expectFeasible = (fx.sucroseDelta >= -r0.grams.sucrose) && (fx.dextroseDelta >= -r0.grams.dextrose);
  ok(fx.feasible === expectFeasible, `${c.id}: feasibility flag consistent`);
  if (fx.projected !== null) {
    close(fx.projected.pod100, c.expected.fix.P, 0.02, `${c.id}: projected POD on target`);
    close(fx.projected.frozenPct, c.expected.fix.F, 0.02, `${c.id}: projected frozen on target`);
  } else {
    ok(!fx.feasible, `${c.id}: null projection only when infeasible`);
  }
}

// ---------- 2. Physics spot checks (hand-computable) ----------
{
  // 100 g sucrose in exactly 1 kg water: 0.29212 mol -> dT = 1.86*0.29212 = 0.54334 C
  const r = G.analyze({ water: 1000, sucrose: 100, serveTemp: -12 });
  close(r.dT, 1.86 * (100 / 342.30), 1e-9, 'cryoscopic reference dT');
  close(r.frozenPct, (1 - r.dT / 12) * 100, 1e-9, 'frozen fraction formula');
  ok(r.initialFreezeC === -r.dT, 'initial freeze point is -dT');
}
{
  // frozenFraction edge cases
  ok(G.frozenFraction(2, -1) === 0, 'below initial freeze point nothing freezes');
  close(G.frozenFraction(2, -12), 1 - 2 / 12, 1e-12, 'frozen fraction linear in dT/|T|');
  ok(G.frozenFraction(2, -24) > G.frozenFraction(2, -12), 'colder freezer freezes more');
}
{
  // lactose contributes to POD and freezing even with no added sugar
  const noSugar = G.analyze({ milk: 1000, serveTemp: -12 });
  const withSugar = G.analyze({ milk: 1000, sucrose: 100, serveTemp: -12 });
  ok(noSugar.pod100 > 0, 'milk-only mix still has lactose sweetness');
  ok(noSugar.dT > 0 && withSugar.dT > noSugar.dT, 'sugar raises freezing depression');
}
{
  // honey depresses freezing more than the same grams of sucrose (lower MW fraction)
  const s = G.analyze({ milk: 500, sucrose: 100, serveTemp: -12 });
  const h = G.analyze({ milk: 500, honey: 100, serveTemp: -12 });
  ok(h.dT > s.dT, 'honey (invert-like) depresses freezing more per gram than sucrose');
}

// ---------- 3. Verdicts ----------
{
  const lean = G.analyze({ milk: 1000, sucrose: 80, serveTemp: -12 });
  const v = Object.fromEntries(lean.verdicts.map(x => [x.label, x.band]));
  ok(v['Fat'] === 'low', 'lean mix: fat low');
  ok(v['Added sugars'] === 'low', 'lean mix: sugars low');
  ok(v['Sweetness (POD)'] === 'low', 'lean mix: POD low');
  ok(v['Frozen water at -12 C'] === 'high', 'lean mix freezes rock hard');
  const rich = G.analyze({ cream: 600, milk: 200, sucrose: 180, dextrose: 60, serveTemp: -12 });
  const v2 = Object.fromEntries(rich.verdicts.map(x => [x.label, x.band]));
  ok(v2['Fat'] === 'high', 'rich mix: fat high');
  ok(v2['Frozen water at -12 C'] === 'ok', 'rich+sweet mix scoopable');
}

// ---------- 4. Fix solver edge behaviour ----------
{
  // already on target -> deltas ~0
  const base = { milk: 600, cream: 250, sucrose: 130, dextrose: 45, yolk: 60, serveTemp: -12 };
  const r0 = G.analyze(base);
  const f0 = G.fix(base, r0.pod100, r0.frozenPct);
  close(f0.sucroseDelta, 0, 1e-6, 'on-target fix: zero sucrose delta');
  close(f0.dextroseDelta, 0, 1e-6, 'on-target fix: zero dextrose delta');
  // infeasible: would need to remove more sucrose than exists
  const lean = { milk: 900, cream: 100, sucrose: 20, dextrose: 0, serveTemp: -12 };
  const f1 = G.fix(lean, 12, 45); // wants way less freezing + less sweet -> remove lots
  ok(f1.feasible === false, 'infeasible fix flagged when removal exceeds contents');
  ok(f1.projected === null, 'infeasible fix has no projected mix');
}

// ---------- 5. Validation ----------
throwsWith(() => G.analyze(null), 'Missing input', 'null input');
throwsWith(() => G.analyze({}), 'mix is empty', 'empty mix');
throwsWith(() => G.analyze({ sucrose: 100 }), 'No water phase', 'sugar only, no water');
throwsWith(() => G.analyze({ milk: -5 }), 'between 0 and 10000', 'negative grams');
throwsWith(() => G.analyze({ milk: 'lots' }), 'must be a number', 'junk grams');
throwsWith(() => G.analyze({ milk: 500, serveTemp: -40 }), 'between -25 and -1', 'serve temp too low');
throwsWith(() => G.analyze({ milk: 500, serveTemp: 4 }), 'between -25 and -1', 'serve temp positive');
throwsWith(() => G.analyze({ milk: 500, overrunPct: 300 }), 'between 0 and 120', 'overrun range');
throwsWith(() => G.fix({ milk: 500, sucrose: 100 }, 100, 70), 'between 8 and 40', 'target POD range');
throwsWith(() => G.fix({ milk: 500, sucrose: 100 }, 20, 10), 'between 40 and 95', 'target frozen range');
ok(G.analyze({ milk: '500' }).W === 500, 'string numbers coerce');

// ---------- 6. esc ----------
ok(G.esc('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;', 'esc script');
ok(G.esc("a & \"b\" 'c'") === 'a &amp; &quot;b&quot; &#39;c&#39;', 'esc all five');
ok(G.esc(42) === '42', 'esc coerces');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
