#!/usr/bin/env node
// Regenerate the flat per-task `benchmarks[]` registry in suite.yml from the task manifests.
//
// A task is registered only once it carries an `implementation.commit` (i.e. it has been
// built/bound); G0-pending design scaffolds have no commit and stay out of the registry, per the
// suite.yml note. Each record mirrors its manifest field-for-field so `audit_benchmark.mjs`
// validateSuite binds cleanly (the comparison is strict: null stays null, '1' stays the string
// '1', and gate/array order is preserved). Re-run after any gate flip (e.g. F6-offense G0
// re-attestation, F4-defense G0) — the record mirrors gate statuses, so a flip makes it stale.
//
// Usage: node build_suite_registry.mjs [--repo-root <path>] [--check]
//   (default repo-root: cwd). With --check it writes nothing and exits nonzero if the committed
//   benchmarks[] no longer matches the manifests (CI/runbook guard against a silently stale registry).

import fs from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const root = path.resolve(arg('--repo-root', process.cwd()));
const suitePath = path.join(root, '.agents/cyber-benchmarks/suite.yml');
const suiteText = fs.readFileSync(suitePath, 'utf8');
const suite = parse(suiteText);

function manifestFor(taskPath) {
  const file = path.join(root, taskPath, 'benchmark.yml');
  return parse(fs.readFileSync(file, 'utf8'));
}

function recordFor(m) {
  const taskRelative = m.implementation.path;
  const gateEntries = Object.entries(m.gates ?? {});
  return {
    id: m.id,
    display_name: m.name ?? null,
    owner: m.owner ?? null,
    owning_branch_or_package: 'plugins/cyber',
    path: taskRelative,
    mode_profile: m.mode,
    primary_construct_id: m.primary_construct_id,
    construct_summary: m.primary_construct ?? null,
    primary_coverage: m.primary_coverage,
    secondary_coverage: m.secondary_coverage ?? [],
    intended_evidence_level: m.evidence?.intended_evidence_level ?? null,
    achieved_evidence_level: m.evidence?.achieved_evidence_level ?? null,
    gates: Object.fromEntries(gateEntries.map(([g, v]) => [g, v?.status])),
    gate_evidence: Object.fromEntries(gateEntries.map(([g, v]) => [g, v?.evidence ?? []])),
    calibration_result: m.calibration?.result ?? null,
    approved_claim_path: `${taskRelative}/${m.claims?.approved_text_path}`,
    explicit_nonclaims: m.claims?.nonclaims ?? [],
    paired_task_id: m.pairing?.paired_task_id ?? null,
    paired_role: m.pairing?.paired_role ?? null,
    pair_contract_version: m.pairing?.pair_contract_version ?? null,
  };
}

const records = [];
for (const family of suite.families ?? []) {
  for (const side of ['offense', 'defense']) {
    const entry = family[side];
    if (!entry?.path) {
      continue;
    }
    const m = manifestFor(entry.path);
    if (typeof m.implementation?.commit === 'string' && m.implementation.commit) {
      records.push(recordFor(m));
    }
  }
}
records.sort((a, b) => a.id.localeCompare(b.id));

const idx = suiteText.search(/^benchmarks:/m);
if (idx < 0) {
  throw new Error('suite.yml has no top-level `benchmarks:` key to replace');
}
const head = suiteText.slice(0, idx).replace(/\s*$/, '\n\n');
const block = stringify({ benchmarks: records }, { lineWidth: 0 });

if (process.argv.includes('--check')) {
  // Compare semantically (values, not formatting) so prettier style never trips the guard.
  const committed = JSON.stringify(suite.benchmarks ?? []);
  const expected = JSON.stringify(records);
  if (committed !== expected) {
    process.stderr.write(
      'STALE: suite.yml benchmarks[] no longer matches the task manifests (a gate flip or manifest ' +
        'change?). Re-run `node build_suite_registry.mjs` and commit the regenerated suite.yml.\n',
    );
    process.exit(1);
  }
  process.stderr.write(`suite.yml registry is current (${records.length} record(s)).\n`);
  process.exit(0);
}

fs.writeFileSync(suitePath, head + block);
process.stderr.write(`Wrote ${records.length} benchmark record(s) to ${suitePath}\n`);
