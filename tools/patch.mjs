import fs from 'node:fs';
const p = 'tools/sim-lab.ts';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 50)); s = s.replace(a, b); };
rep(`gapWins: {} as Record<string, [number, number]>,`, `gapWins: {} as Record<string, [number, number]>, press: { calm: [0, 0, 0], high: [0, 0, 0] },`);
rep(`    if (d.illegalField) agg.illegal++;`, `    if (d.illegalField) agg.illegal++;
    if (d.legal && !d.extras) {
      const b = d.pressure.batter >= 0.35 ? agg.press.high : d.pressure.batter < 0.05 ? agg.press.calm : null;
      if (b) { b[0]++; b[1] += d.batRuns; if (d.wicket) b[2]++; }
    }`);
rep("console.log(`Illegal-field", "const pr = (b: number[]) => `${b[0]} balls, ${(b[1] / b[0]).toFixed(2)} runs/ball, wicket every ${(b[0] / Math.max(1, b[2])).toFixed(1)} balls`;\nconsole.log(`Batter under pressure (index ≥0.35): ${pr(agg.press.high)}`);\nconsole.log(`Batter calm (index <0.05):          ${pr(agg.press.calm)}`);\nconsole.log(`Illegal-field");
fs.writeFileSync(p, s);
