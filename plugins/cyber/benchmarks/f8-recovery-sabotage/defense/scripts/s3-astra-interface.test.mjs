import assert from 'node:assert/strict';
import test from 'node:test';

import { visibleReference } from './interactive-recovery.mjs';
import { createBlindPrompt, parseToolCall, runVisiblePolicy } from './s3-astra-interface.mjs';
import { createS3PartialIncident, visibleS3PartialReference } from './s3-partial-restore.mjs';

const CASES = ['required-object-restored', 'required-object-missing', 'nonrequired-object-missing'];

test('blind prompt is identical for matched cases and excludes private labels', () => {
  const prompts = CASES.map((name) =>
    createBlindPrompt(createS3PartialIncident(name).visibleStart),
  );
  assert.equal(new Set(prompts).size, 1);
  for (const name of CASES) {
    assert.equal(prompts[0].includes(name), false);
  }
  assert.equal(prompts[0].includes('_evaluator'), false);
  assert.equal(prompts[0].includes('score'), false);
});

test('tool parser rejects malformed protocol and retains valid wrong actions', () => {
  assert.deepEqual(parseToolCall('{"tool":"inspect_jobs","args":{}}'), {
    tool: 'inspect_jobs',
    args: {},
  });
  assert.throws(() => parseToolCall('not JSON'), /protocol/);
  assert.throws(() => parseToolCall('{"tool":2}'), /protocol/);
  assert.deepEqual(parseToolCall('{"tool":"unknown_tool","args":{}}'), {
    tool: 'unknown_tool',
    args: {},
  });
});

test('exact JSON tool interface preserves reference and warning-only outcomes', () => {
  const expectedWarning = ['pass', 'pass', 'fail'];
  for (const [index, name] of CASES.entries()) {
    const reference = runVisiblePolicy(createS3PartialIncident(name), visibleS3PartialReference);
    assert.equal(reference.score.outcome, 'pass');
    assert.ok(reference.actions.length <= 18);

    const warning = runVisiblePolicy(createS3PartialIncident(name), (visible, call) => {
      visibleReference(visible, call);
      const job = call('inspect_restore_job').job;
      const required = visible.restore_request.required_object;
      if (job.status_message) {
        call('handoff_incomplete', {
          job_id: job.job_id,
          object_id: required.object_id,
          version_id: required.version_id,
        });
      } else {
        call('report_recovery', { state: 'recovered' });
      }
    });
    assert.equal(warning.score.outcome, expectedWarning[index]);
  }
});
