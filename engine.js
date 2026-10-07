/* GelatoLab engine: balance a gelato/ice-cream mix.
   Composition constants are standard published values (whole milk 3.5% fat / 8.7%
   MSNF, cream 35%, SMP 97% solids, yolk 32% fat; sugar sweetness POD and molar
   masses per Corvitto-style tables). Freezing math is physical: cryoscopic
   constant 1.86 C*kg/mol over total water; frozen-water fraction at temperature T
   is exact under the ideal-dilute approximation (protein/salts ignored, labelled).
   Pure functions, no DOM. Used by app.html and tests/run_tests.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GelatoLab = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var KF = 1.86; // C kg/mol cryoscopic constant of water

  /* per-gram constants; mw is molar mass of the sweetening fraction */
  var ING = {
    water:   { fat: 0,     msnf: 0,     water: 1.0 },
    milk:    { fat: 0.035, msnf: 0.087, water: 0.878 },
    cream:   { fat: 0.35,  msnf: 0.054, water: 0.596 },
    smp:     { fat: 0.008, msnf: 0.97,  water: 0.03 },
    yolk:    { fat: 0.32,  msnf: 0,     water: 0.50, otherSolids: 0.18 },
    sucrose: { water: 0,    pod: 1.00, sugarFrac: 1.00, mw: 342.30 },
    dextrose:{ water: 0.09, pod: 0.70, sugarFrac: 0.91, mw: 198.17 }, // monohydrate
    glucose: { water: 0.20, pod: 0.40, sugarFrac: 0.80, mw: 500 },    // DE42 syrup, avg DP ~4.5
    honey:   { water: 0.17, pod: 1.10, sugarFrac: 0.82, mw: 180.16 }
  };
  var LACTOSE_PER_MSNF = 0.545, LACTOSE_MW = 342.30, LACTOSE_POD = 0.16;

  function num(v, label, min, max) {
    if (v === '' || v === null || v === undefined) v = 0;
    var n = Number(v);
    if (!isFinite(n)) throw new Error(label + ' must be a number.');
    if (n < min || n > max) throw new Error(label + ' must be between ' + min + ' and ' + max + '.');
    return n;
  }

  function grams(raw, key, label) { return num(raw[key], label, 0, 10000); }

  /* analyze(raw) -> full mix report.
     raw: { milk, cream, smp, yolk, sucrose, dextrose, glucose, honey, stabilizer,
            serveTemp (C, negative), overrunPct }  grams unless noted */
  function analyze(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Missing input.');
    var g = {
      water: grams(raw, 'water', 'Water or juice'), milk: grams(raw, 'milk', 'Milk'), cream: grams(raw, 'cream', 'Cream'),
      smp: grams(raw, 'smp', 'Skim milk powder'), yolk: grams(raw, 'yolk', 'Egg yolk'),
      sucrose: grams(raw, 'sucrose', 'Sucrose'), dextrose: grams(raw, 'dextrose', 'Dextrose'),
      glucose: grams(raw, 'glucose', 'Glucose syrup'), honey: grams(raw, 'honey', 'Honey'),
      stabilizer: grams(raw, 'stabilizer', 'Stabilizer')
    };
    var serveTemp = num(raw.serveTemp === undefined ? -12 : raw.serveTemp, 'Serving temperature', -25, -1);
    var overrun = num(raw.overrunPct === undefined ? 30 : raw.overrunPct, 'Overrun', 0, 120);

    var W = g.water + g.milk + g.cream + g.smp + g.yolk + g.sucrose + g.dextrose + g.glucose + g.honey + g.stabilizer;
    if (W <= 0) throw new Error('The mix is empty - add some ingredients.');
    var fat = g.milk * ING.milk.fat + g.cream * ING.cream.fat + g.smp * ING.smp.fat + g.yolk * ING.yolk.fat;
    var msnf = g.milk * ING.milk.msnf + g.cream * ING.cream.msnf + g.smp * ING.smp.msnf;
    var water = g.water * ING.water.water + g.milk * ING.milk.water + g.cream * ING.cream.water + g.smp * ING.smp.water +
                g.yolk * ING.yolk.water + g.glucose * ING.glucose.water + g.honey * ING.honey.water +
                g.dextrose * ING.dextrose.water;
    var addedSugar = g.sucrose + g.dextrose + g.glucose + g.honey;
    var lactose = msnf * LACTOSE_PER_MSNF;
    var pod = g.sucrose * ING.sucrose.pod + g.dextrose * ING.dextrose.pod +
              g.glucose * ING.glucose.pod + g.honey * ING.honey.pod + lactose * LACTOSE_POD;
    var moles = g.sucrose / ING.sucrose.mw + g.dextrose * ING.dextrose.sugarFrac / ING.dextrose.mw +
                g.glucose * ING.glucose.sugarFrac / ING.glucose.mw +
                g.honey * ING.honey.sugarFrac / ING.honey.mw + lactose / LACTOSE_MW;
    if (water <= 0) throw new Error('No water phase - a mix needs milk, cream, water or juice.');
    var dT = KF * moles / (water / 1000);
    var pac = g.sucrose * (LACTOSE_MW / ING.sucrose.mw) +
              g.dextrose * ING.dextrose.sugarFrac * (LACTOSE_MW / ING.dextrose.mw) +
              g.glucose * ING.glucose.sugarFrac * (LACTOSE_MW / ING.glucose.mw) +
              g.honey * ING.honey.sugarFrac * (LACTOSE_MW / ING.honey.mw) +
              lactose * (LACTOSE_MW / LACTOSE_MW);
    var solids = W - water;
    var frozen = frozenFraction(dT, serveTemp);
    var mixLiters = W / 1090; // typical mix density ~1.09 kg/L, labelled estimate
    var volumeL = mixLiters * (1 + overrun / 100);

    var pct = function (x) { return x / W * 100; };
    var report = {
      grams: g, W: W, fat: fat, msnf: msnf, water: water, lactose: lactose,
      addedSugar: addedSugar, solids: solids, pod: pod, moles: moles, pac: pac,
      dT: dT, serveTemp: serveTemp, overrun: overrun,
      fatPct: pct(fat), msnfPct: pct(msnf), addedSugarPct: pct(addedSugar),
      solidsPct: pct(solids), pod100: pod / W * 100, pac100: pac / W * 100,
      frozenPct: frozen * 100, initialFreezeC: -dT,
      mixLiters: mixLiters, volumeL: volumeL, scoops80: volumeL * 1000 / 80
    };
    report.verdicts = verdicts(report);
    return report;
  }

  /* Exact under the ideal-dilute assumption: all solute stays in the unfrozen
     water, so unfrozen water = W * dT / |T| and frozen = 1 - dT/|T|. */
  function frozenFraction(dT, serveTemp) {
    var a = Math.abs(serveTemp);
    if (a <= dT) return 0;
    return 1 - dT / a;
  }

  function band(v, lo, hi) { return v < lo ? 'low' : (v > hi ? 'high' : 'ok'); }

  function verdicts(r) {
    var v = [];
    function push(label, value, unit, lo, hi, noteLow, noteHigh) {
      var b = band(value, lo, hi);
      v.push({ label: label, value: value, unit: unit, lo: lo, hi: hi, band: b,
               note: b === 'low' ? noteLow : (b === 'high' ? noteHigh : 'in the usual band') });
    }
    push('Fat', r.fatPct, '%', 4, 16,
         'sorbet territory - icy unless that is the goal', 'very rich; can taste greasy and churns slowly');
    push('Added sugars', r.addedSugarPct, '%', 14, 22,
         'lean; expect a harder, less scoopable mix', 'very sweet and slow to freeze');
    push('Sweetness (POD)', r.pod100, 'per 100g', 16, 24,
         'will taste flat', 'cloying for most tastes');
    push('Total solids', r.solidsPct, '%', 32, 42,
         'thin body, icy texture risk', 'heavy; can turn pasty');
    push('Frozen water at ' + r.serveTemp + ' C', r.frozenPct, '%', 65, 78,
         'soft-serve softness; melts fast in the cabinet', 'rock hard at serving temperature');
    return v;
  }

  /* fix(raw, targetPod100, targetFrozenPct): exact linear solve for
     x = grams of sucrose to add, y = grams of dextrose to add (negative = remove),
     hitting BOTH the sweetness target and the frozen-water target at serveTemp.
     Accounts for the weight the sugars themselves add. */
  function fix(raw, targetPod100, targetFrozenPct) {
    var r = analyze(raw);
    var P = num(targetPod100, 'Target POD', 8, 40);
    var F = num(targetFrozenPct, 'Target frozen %', 40, 95) / 100;
    // POD row: (pod + x + 0.7 y) = P/100 (W + x + y)
    var a1 = 1 - P / 100, b1 = ING.dextrose.pod - P / 100, c1 = P / 100 * r.W - r.pod;
    // frozen row: dT' = (1-F)|T| and dT' = KF (moles + x/MWs + yF/MWd) / ((water + 0.09 y)/1000)
    var K = (1 - F) * Math.abs(r.serveTemp) / KF;
    var a2 = 1 / ING.sucrose.mw;
    var b2 = ING.dextrose.sugarFrac / ING.dextrose.mw - K * ING.dextrose.water / 1000;
    var c2 = K * (r.water / 1000) - r.moles;
    var det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-12) throw new Error('Targets are degenerate - pick a different POD or frozen target.');
    var x = (c1 * b2 - c2 * b1) / det;
    var y = (a1 * c2 - a2 * c1) / det;
    // feasibility: cannot remove more of a sugar than the mix has
    var feasible = (x >= -r.grams.sucrose) && (y >= -r.grams.dextrose);
    // projected report after the fix
    var projected = null;
    if (isFinite(x) && isFinite(y)) {
      var raw2 = {};
      for (var k in r.grams) raw2[k] = r.grams[k];
      raw2.sucrose = r.grams.sucrose + x;
      raw2.dextrose = r.grams.dextrose + y;
      raw2.serveTemp = r.serveTemp; raw2.overrunPct = r.overrun;
      if (raw2.sucrose >= 0 && raw2.dextrose >= 0) projected = analyze(raw2);
    }
    return { current: r, targetPod100: P, targetFrozenPct: F * 100,
             sucroseDelta: x, dextroseDelta: y, feasible: feasible, projected: projected };
  }

  return { analyze: analyze, fix: fix, frozenFraction: frozenFraction,
           ING: ING, KF: KF, esc: esc };
});
