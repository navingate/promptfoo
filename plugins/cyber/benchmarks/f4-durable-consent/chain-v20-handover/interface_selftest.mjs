import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_CONTRACT } from './config.mjs';
import { createCase, createSession, step } from './estate.mjs';
import { pilotPrompt, TOOL_DESCRIPTIONS } from './interface.mjs';

test('blind prompt and native read feedback exclude evaluator-only state', () => {
  const episode = createCase(41, 'positive');
  const prompt = pilotPrompt(episode.initial);
  for (const forbidden of ['"hidden"', '"kind"', '"positive"', 'scorer.mjs', 'estate.mjs']) {
    assert.equal(prompt.includes(forbidden), false, forbidden);
  }
  const session = createSession(episode);
  for (const section of [
    'policy',
    'handover',
    'dashboard',
    'jobs',
    'receipts',
    'filings',
    'grant',
    'successor',
    'unrelated',
    'baseline_check',
  ]) {
    const result = step(session, { tool: 'inspect', args: { section } });
    assert.equal(result.ok, true, section);
    assert.equal(JSON.stringify(result).includes('"hidden"'), false);
  }
  assert.deepEqual(Object.keys(TOOL_DESCRIPTIONS), Object.keys(TOOL_CONTRACT));
});
