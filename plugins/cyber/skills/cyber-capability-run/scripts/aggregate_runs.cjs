#!/usr/bin/env node
// Aggregate several cybench/authored run JSONs into a Pass@k report.
//
// A single eval run is noisy — the SET of solved tasks shifts run to run. This reads k
// run outputs and reports the stable picture: which tasks solve in ANY run (Pass@k),
// which solve in EVERY run (reliable), the mean solve count, and per-task frequency.
//
// Usage:
//   node aggregate_runs.js out.qwen-cybench.run*.json
//   node aggregate_runs.js out.deepseek-authored.run1.json out.deepseek-authored.run2.json ...
//
// Bucketing mirrors the inline one-liners: an errored task (missing image / infra / ctx)
// is NOT counted as a non-solve — it never ran, so it is excluded from the runnable
// denominator for the run(s) where it errored.

const fs = require("fs");

const files = process.argv.slice(2).filter((f) => {
  if (fs.existsSync(f)) return true;
  console.error("skip (missing):", f);
  return false;
});
if (!files.length) {
  console.error("usage: node aggregate_runs.js <run1.json> [run2.json ...]");
  process.exit(1);
}

const IMG = /failed to resolve reference|No services started/i;
const INFRA = /harness_error|RuntimeError|BadRequestError|Traceback/i;
const CTX = /context length/i;

// task -> { solved, ran, err }  (counts across the k runs)
const tasks = {};
const perRun = []; // { file, solved, runnable, errored }
let k = 0;

for (const f of files) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    console.error("skip (bad json):", f);
    continue;
  }
  const rows = (j.results && j.results.results) || [];
  if (!rows.length) {
    console.error("skip (no results):", f);
    continue;
  }
  k++;
  let solved = 0,
    runnable = 0,
    errored = 0;
  for (const x of rows) {
    const t = (x.vars && x.vars.task) || "?";
    const e = String(x.error || "");
    tasks[t] = tasks[t] || { solved: 0, ran: 0, err: 0 };
    if (x.success) {
      tasks[t].solved++;
      tasks[t].ran++;
      solved++;
      runnable++;
    } else if (IMG.test(e) || INFRA.test(e) || CTX.test(e)) {
      tasks[t].err++;
      errored++;
    } else {
      tasks[t].ran++; // genuine non-solve = it ran
      runnable++;
    }
  }
  perRun.push({ file: f.replace(/^.*\//, ""), solved, runnable, errored });
}

if (!k) {
  console.error("no usable run files");
  process.exit(1);
}

const names = Object.keys(tasks).sort();
const solvedAny = names.filter((t) => tasks[t].solved > 0);
const solvedAll = names.filter((t) => tasks[t].solved === k && tasks[t].err === 0);
const runnableAny = names.filter((t) => tasks[t].ran > 0);
const neverRan = names.filter((t) => tasks[t].ran === 0);

const meanSolved = perRun.reduce((s, r) => s + r.solved, 0) / k;
const meanRunnable = perRun.reduce((s, r) => s + r.runnable, 0) / k;
const solvedCounts = perRun.map((r) => r.solved);
const minS = Math.min(...solvedCounts);
const maxS = Math.max(...solvedCounts);

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

console.log(`\n=== Pass@k report (k=${k} runs) ===`);
for (const r of perRun)
  console.log(
    `  run ${r.file}: solved ${r.solved} / runnable ${r.runnable} (${pct(r.solved, r.runnable)}), errored ${r.errored}`,
  );
console.log(`\ntasks total: ${names.length}  |  runnable in >=1 run: ${runnableAny.length}`);
console.log(
  `Pass@${k} (solved in >=1 run):   ${solvedAny.length} / ${runnableAny.length}  (${pct(solvedAny.length, runnableAny.length)})`,
);
console.log(
  `reliable (solved in ALL ${k}):   ${solvedAll.length} / ${runnableAny.length}  (${pct(solvedAll.length, runnableAny.length)})`,
);
console.log(
  `mean solved/run:                 ${meanSolved.toFixed(1)} / ${meanRunnable.toFixed(1)} (${pct(meanSolved, meanRunnable)})  [range ${minS}-${maxS}]`,
);
console.log(`\nreliable solvers (all ${k}): ${solvedAll.join(", ") || "(none)"}`);
console.log(
  `flaky (some runs):          ${solvedAny.filter((t) => !solvedAll.includes(t)).map((t) => `${t}(${tasks[t].solved}/${k})`).join(", ") || "(none)"}`,
);
if (neverRan.length) console.log(`\nnever ran (image/infra error every run): ${neverRan.join(", ")}`);
