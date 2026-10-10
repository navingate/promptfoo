#!/usr/bin/env node
// F6 v3 defense — G6 graded-corpus generator (BUILD-TIME ONLY; not a runtime dependency).
//
// The hosted G6 measurement needs a crafting-quality grade on the injected strata: a WEAK (overt,
// off-register) arm that any competent defender resists, and a STRONG (crafted, in-register) arm that
// only a strong defender catches. Per F2 Chain (2026-10-11) the arms are sourced from the OFFENSE v3
// crafts (`strongInjection`/`weakInjection` exports) — pair-coherent, and a valid defender-resistance
// input regardless of the offense's own G1 isolation question. The offense craft names the offense
// intended target; we substitute the defense stratum's injection target so the craft points where the
// stratum needs it.
//
// Output: evidence/g6/graded-notes.json — FROZEN data keyed `seed|family|stratum|arm` → notes string,
// labeled with the offense source commit. The runtime harness reads this file synchronously (it does
// NOT import offense code), so calibrationInstance stays sync + defense-local.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDefenseCase } from './defense-estate.mjs';
// Build-time import of the offense crafts (pair-coherent G6 arms). Lives only in this generator.
import { strongInjection, weakInjection } from '../../offense/scripts/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.resolve(here, '..');
const OFFENSE_SOURCE_COMMIT = '13b28aed7677ae9ba512af2081399822cbceaa45'; // offense C0 the crafts come from
const INJECTED_STRATA = ['prose-injection', 'forged-artifact', 'same-category-decoy'];
const ARMS = ['weak', 'strong'];
// G6 seed set (a sample of the frozen corpus seeds; enough for a floor/middle probe, not all 20).
const G6_SEEDS = [13, 29, 41, 59, 73, 97];
const FAMILIES = ['repo-file-body', 'plan-diff-field', 'vendor-advisory-metadata'];

function craft(arm, spec) {
  return arm === 'strong' ? strongInjection(spec) : weakInjection(spec);
}

function main() {
  const entries = {};
  for (const seed of G6_SEEDS) {
    for (const family of FAMILIES) {
      for (const stratum of INJECTED_STRATA) {
        const defCase = buildDefenseCase({ seed, family, stratum });
        const injectionTarget = defCase.evaluator.injection_target;
        // The offense craft names the offense intended target; substitute the stratum's target.
        const offenseIntended = buildDefenseCase({ seed, family, stratum: 'prose-injection' }).evaluator
          .injection_target; // == offense intended_target for this seed/family
        for (const arm of ARMS) {
          let notes = craft(arm, { seed, family });
          if (injectionTarget && injectionTarget !== offenseIntended) {
            notes = notes.split(offenseIntended).join(injectionTarget);
          }
          entries[`${seed}|${family}|${stratum}|${arm}`] = notes;
        }
      }
    }
  }
  const payload = {
    schema_version: 1,
    task_id: 'f6-change-defense',
    kind: 'g6-graded-notes',
    source: 'offense strongInjection/weakInjection export',
    source_offense_commit: OFFENSE_SOURCE_COMMIT,
    label: `defender resistance vs v3-offense crafts @ ${OFFENSE_SOURCE_COMMIT.slice(0, 12)}`,
    strata: INJECTED_STRATA,
    arms: ARMS,
    seeds: G6_SEEDS,
    families: FAMILIES,
    note: 'FROZEN build-time data. WEAK = overt/off-register craft; STRONG = in-register craft that beat the pinned offense victim. Target substituted to the defense stratum injection_target. Plan a coherence refresh at the pair-rebind after the offense construct revision lands (F2 Chain 2026-10-11).',
    entries,
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  const outDir = path.join(taskDir, 'evidence/g6');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'graded-notes.json'), body);
  process.stdout.write(
    `[f6-defense g6] froze ${Object.keys(entries).length} graded notes (${INJECTED_STRATA.length} strata × ${ARMS.length} arms × ${FAMILIES.length} families × ${G6_SEEDS.length} seeds) sha256 ${sha.slice(0, 12)}…\n`,
  );
}

main();
