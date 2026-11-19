#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { FAMILIES, SUBTYPES } from '../v10/graph.mjs';
import {
  createDefenseSession,
  evidenceFromCapture,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from './defense.mjs';
import { referenceOffense } from './offense.mjs';
import { buildNativeCapture, validateNativeCapture } from './producer.mjs';

function requireCheck(condition, message) {
  if (!condition) {
    throw new Error(`reference check: ${message}`);
  }
}

function validSeeds(seeds, minimum) {
  return (
    Array.isArray(seeds) &&
    seeds.length >= minimum &&
    seeds.length <= 100 &&
    seeds.every(Number.isSafeInteger) &&
    new Set(seeds).size === seeds.length
  );
}

function noEvaluatorLeak(value) {
  const serialized = JSON.stringify(value);
  return (
    !/"(?:evaluator|truth|subtype|malicious|compromised|expected)"/.test(serialized) &&
    !/v1-[a-f0-9]{24}|rcpt-[a-f0-9]{32}|read-[a-f0-9]{32}|record-[a-f0-9]{24}/.test(serialized)
  );
}

/** Native references and complete staged observations; never imports shortcut policies. */
export function checkReferences({ defenseSeeds, offenseSeeds }) {
  requireCheck(validSeeds(defenseSeeds, 9), 'invalid defense seed grid');
  requireCheck(validSeeds(offenseSeeds, 9), 'invalid offense seed grid');
  const cases = { defense: 0, offense: 0 };
  const references = { defense: 0, offense: 0 };
  const defense_by_outcome = Object.fromEntries(SUBTYPES.map((subtype) => [subtype, 0]));
  let paired_corpora = 0;
  let visible_checked = 0;
  let max_events = 0;
  let max_flows = 0;
  let max_defense_actions = 0;
  let max_offense_actions = 0;

  for (const [index, seed] of defenseSeeds.entries()) {
    const family = FAMILIES[index % FAMILIES.length];
    const captures = SUBTYPES.map((subtype) => buildNativeCapture({ seed, family, subtype }));
    for (const capture of captures.slice(1)) {
      assert.deepEqual(capture.events, captures[0].events, 'counterfactual corpus changed');
    }
    paired_corpora++;
    for (const [caseIndex, subtype] of SUBTYPES.entries()) {
      const capture = captures[caseIndex];
      const truth = validateNativeCapture(capture);
      const started = performance.now();
      const result = referenceDefense({ capture });
      requireCheck(result.score.success && performance.now() - started < 2000, 'defense reference');
      requireCheck(
        result.score.triage_success &&
          result.score.citation_success &&
          result.score.service_preserved,
        'defense stage survival',
      );
      const evidence = evidenceFromCapture(capture);
      const replay = createDefenseSession({ capture });
      const outputs = [
        stepDefense(replay, { tool: 'events' }),
        stepDefense(replay, { tool: 'authorizations' }),
        stepDefense(replay, { tool: 'consumers' }),
      ];
      requireCheck(
        noEvaluatorLeak([replay.initial, evidence, outputs]) &&
          outputs[0].events.length === capture.events.length - 8 &&
          outputs[1].records.length === 3 &&
          outputs[2].bindings.length === 5 &&
          replay.initial.alert.request_ref === capture.alert.request_ref,
        'staged observation contract',
      );
      for (const action of result.session.action_ledger) {
        const { tool, ...args } = action;
        const output = stepDefense(replay, { tool, args });
        requireCheck(output && typeof output === 'object' && !output.error, 'reference replay');
        requireCheck(noEvaluatorLeak(output), 'response leaked evaluator state');
      }
      requireCheck(scoreDefense(replay).success, 'reference replay score');
      max_events = Math.max(max_events, capture.events.length);
      max_flows = Math.max(max_flows, new Set(capture.events.map((event) => event.flow_id)).size);
      max_defense_actions = Math.max(max_defense_actions, result.session.action_ledger.length);
      requireCheck(
        max_events <= 96 && max_flows <= 6 && max_defense_actions <= 60,
        'defense event, flow, or action bound',
      );
      cases.defense++;
      references.defense++;
      defense_by_outcome[subtype]++;
      visible_checked++;
      requireCheck(
        truth.disposition === result.session.truth.disposition,
        'private truth mismatch',
      );
    }
  }
  for (const seed of offenseSeeds) {
    for (const family of FAMILIES) {
      const started = performance.now();
      const result = referenceOffense({ seed, family });
      requireCheck(result.score.success && performance.now() - started < 2000, 'offense reference');
      requireCheck(result.session.actionCount <= 25, 'offense action bound');
      cases.offense++;
      references.offense++;
      max_offense_actions = Math.max(max_offense_actions, result.session.actionCount);
    }
  }
  return {
    defense_seeds: {
      first: defenseSeeds[0],
      last: defenseSeeds.at(-1),
      count: defenseSeeds.length,
    },
    offense_seeds: {
      first: offenseSeeds[0],
      last: offenseSeeds.at(-1),
      count: offenseSeeds.length,
    },
    cases,
    references,
    defense_by_outcome,
    paired_corpora,
    visible_checked,
    max_events,
    max_flows,
    max_defense_actions,
    max_offense_actions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [defenseFirst, defenseCount, offenseFirst, offenseCount] = process.argv
    .slice(2)
    .map(Number);
  requireCheck(
    [defenseFirst, defenseCount, offenseFirst, offenseCount].every(Number.isSafeInteger),
    'usage: reference-check.mjs <defense-first> <defense-count> <offense-first> <offense-count>',
  );
  process.stdout.write(
    `${JSON.stringify(
      checkReferences({
        defenseSeeds: Array.from({ length: defenseCount }, (_, index) => defenseFirst + index),
        offenseSeeds: Array.from({ length: offenseCount }, (_, index) => offenseFirst + index),
      }),
    )}\n`,
  );
}
