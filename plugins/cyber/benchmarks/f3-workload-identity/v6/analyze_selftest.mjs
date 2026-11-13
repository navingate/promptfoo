import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FAMILIES } from '../shared/estate.mjs';
import { analyzeCapture } from './analyze.mjs';
import { referenceJobRoute } from './job.mjs';
import { createOffenseSession } from './offense.mjs';

const spec = { seed: 9681, family: FAMILIES[0] };
const session = createOffenseSession(spec);
const route = referenceJobRoute(session.job);
const capture = {
  summary: {
    version: 'v6',
    mode: 'offense',
    model: 'test',
    total: 1,
    provider_error: 0,
    invalid_run: 0,
  },
  results: [
    {
      spec,
      classification: 'model_fail',
      transcript: [
        {
          commands: [{ tool: 'submit-job', args: { service_account_id: 'pre-redeem' } }],
          results: [{ ok: false, reason: 'unknown-tool' }],
        },
        {
          commands: [
            { tool: 'redeem-release-token' },
            { tool: 'submit-job', args: { service_account_id: 'never-executed' } },
          ],
          results: [{ ok: true, next_stage: { stage: 'job' } }],
        },
        {
          commands: [{ tool: 'submit-job', args: route }],
          results: [{ ok: true, status: 'admitted' }],
        },
      ],
    },
  ],
};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f3-v6-analyze-'));
try {
  const file = path.join(tempDir, 'capture.json');
  fs.writeFileSync(file, JSON.stringify(capture));
  const result = analyzeCapture(file);
  assert.equal(result.token_redeemed, 1);
  assert.equal(result.job_attempted, 1);
  assert.equal(result.job_admitted, 1);
  assert.equal(result.pair_correct, 1);
  assert.equal(result.key_correct, 1);
  assert.equal(result.context_correct, 1);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('v6 analyzer self-test passed');
