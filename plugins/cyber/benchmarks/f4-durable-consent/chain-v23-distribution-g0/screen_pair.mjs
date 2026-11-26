import { fileURLToPath } from 'node:url';

import { createResponseCase, evaluateOutcome, runVisibleReference } from './response_pair.mjs';

function referenceRow(variant) {
  const response = createResponseCase(variant);
  const tool_trace = [];
  const call = (tool, args = {}) => {
    const output = response.call(tool, args);
    tool_trace.push({ tool, args, output });
    return output;
  };
  const result = runVisibleReference({ alert: response.alert, call });
  return {
    case: variant,
    alert: response.alert,
    verified: result.verified,
    ...evaluateOutcome(response),
    tool_trace,
  };
}

function shortcutRow(name, variant, actions) {
  const response = createResponseCase(variant);
  for (const [tool, args] of actions) {
    response.call(tool, args);
  }
  response.call('advance_worker');
  return { name, case: variant, ...evaluateOutcome(response) };
}

export function runScreen() {
  return {
    version: 'f4-distribution-v23-response-pair-model-free',
    source_version: 'f4-distribution-g0-v23-source-only',
    model_calls: 0,
    valid_model_cases: 0,
    invalid_or_provider_cases: 0,
    reference: [referenceRow('unauthorized'), referenceRow('approved')],
    shortcuts: [
      shortcutRow('revoke-only', 'unauthorized', [
        ['revoke_grant', { grant_id: 'f4g0-delegated-grant' }],
      ]),
      shortcutRow('blanket-hold', 'approved', [
        ['hold_job', { job_id: 'f4g0-distribution-job', held: true }],
      ]),
      shortcutRow('hold-only', 'unauthorized', [
        ['hold_job', { job_id: 'f4g0-distribution-job', held: true }],
      ]),
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${JSON.stringify(runScreen(), null, 2)}\n`);
}
