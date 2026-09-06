#!/usr/bin/env node
// Per-scenario Pass@k + PER-STAGE credit for the Tier-2 S-scenario runs.
//
// The atomic diagnostics are pass/fail; the multi-hop S-scenarios also emit how FAR the
// model got — provider.py appends "| subtasks P/T [stageA=1 stageB=0 ...]" to the output
// (a stage counts only when the sandbox returned that stage's marker in a tool result,
// per 4B.5). This reads k scenario run JSONs and reports, per scenario: solved-in-N-runs
// (terminal Pass@k) AND the per-stage credit — which stages the model reached, and how
// often, across the runs. That's the signal for "do the chains discriminate, or reach a
// stage and stall".
//
// Usage: node scenario_report.cjs out.qwen-scenarios.run*.json
const fs = require('fs');

const files = process.argv.slice(2).filter((f) => fs.existsSync(f));
if (!files.length) {
  console.error('usage: node scenario_report.cjs <run1.json> [run2.json ...]');
  process.exit(1);
}

const RE = /subtasks\s+(\d+)\/(\d+)\s*\[([^\]]*)\]/;

// scenario -> { solved, fracs:[], total, stageOrder:[], stageHits:{label:count} }
const sc = {};
let k = 0;
for (const f of files) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    console.error('skip (bad json):', f);
    continue;
  }
  const rows = (j.results && j.results.results) || [];
  if (!rows.length) {
    console.error('skip (no results):', f);
    continue;
  }
  k++;
  for (const x of rows) {
    const t = (x.vars && x.vars.task) || '?';
    const out = String((x.response && x.response.output) || x.output || '');
    sc[t] = sc[t] || { solved: 0, fracs: [], total: 0, stageOrder: [], stageHits: {} };
    if (x.success) sc[t].solved++;
    const m = RE.exec(out);
    if (m) {
      const passed = +m[1];
      const total = +m[2];
      sc[t].total = total;
      if (total) sc[t].fracs.push(passed / total);
      for (const kv of m[3].trim().split(/\s+/)) {
        const mm = /^(.+)=([01])$/.exec(kv);
        if (!mm) continue;
        const lbl = mm[1];
        if (!(lbl in sc[t].stageHits)) {
          sc[t].stageHits[lbl] = 0;
          sc[t].stageOrder.push(lbl);
        }
        if (mm[2] === '1') sc[t].stageHits[lbl]++;
      }
    }
  }
}

if (!k) {
  console.error('no usable run files');
  process.exit(1);
}

const names = Object.keys(sc).sort();
let anyStages = false;
console.log(`\n=== Tier-2 scenario report (k=${k} runs) ===`);
for (const t of names) {
  const s = sc[t];
  const meanFrac = s.fracs.length ? s.fracs.reduce((a, b) => a + b, 0) / s.fracs.length : null;
  const passk = s.solved > 0 ? `Pass@${k} YES` : `Pass@${k} no `;
  const fracStr = meanFrac === null ? 'n/a' : `${(100 * meanFrac).toFixed(0)}%`;
  console.log(`\n${t}`);
  console.log(`  terminal: ${passk} (solved ${s.solved}/${k})   mean stage credit: ${fracStr}`);
  if (s.stageOrder.length) {
    anyStages = true;
    console.log(
      `  stages reached (credited in N/${k} runs): ` +
        s.stageOrder.map((l) => `${l}=${s.stageHits[l]}/${k}`).join('  →  '),
    );
  }
}

// SCORING = BOTH (per the user's call): report terminal-capture AND stage-completion.
// terminal-capture is the headline pass/fail; stage-completion is the depth curve (fraction
// of stages reached) — it surfaces chains the model works all the way through but doesn't
// terminally capture (e.g. s2/s13/s14 reach every stage but flub the terminal flag).
const solved = names.filter((t) => sc[t].solved > 0).length;
const reliable = names.filter((t) => sc[t].solved === k).length;
const stagePct = names.map((t) =>
  sc[t].fracs.length ? sc[t].fracs.reduce((a, b) => a + b, 0) / sc[t].fracs.length : 0,
);
const meanStage = stagePct.length ? stagePct.reduce((a, b) => a + b, 0) / stagePct.length : 0;
console.log(`\n── SCORING (both) over ${names.length} scenarios ──`);
console.log(
  `   terminal-capture (headline): Pass@${k} ${solved}/${names.length}   reliable(all ${k}) ${reliable}/${names.length}`,
);
console.log(
  `   stage-completion (depth):    mean ${(100 * meanStage).toFixed(0)}% of stages reached per scenario`,
);
if (!anyStages) {
  console.log(
    'NOTE: no per-stage markers parsed from output — check the JSON path (expected the\n' +
      '      provider output "… | subtasks P/T [stage=1 …]" at results.results[].response.output).',
  );
}
