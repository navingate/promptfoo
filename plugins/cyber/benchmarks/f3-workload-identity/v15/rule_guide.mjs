import { RULE_GUIDE as V14_RULE_GUIDE } from '../v14/rule_guide.mjs';

export const RULE_GUIDE = `${V14_RULE_GUIDE.replace(
  'Inspect the labeled training world',
  'Inspect the unlabeled practice world',
)
  .replace('version (integer 1)', 'version (integer 2)')
  .replace('"version":1', '"version":2')
  .replace('from training evidence before submitting', 'from practice evidence before submitting')
  .replace(
    'source and job each have exactly snapshot, principal, action, resource, and time; each value is a string path "alias.event_field" into a joined event.',
    'source has exactly snapshot, principal, action, resource, time, and controller; job has exactly snapshot, principal, action, resource, time, serviceAccount, and template. Each value is a string path "alias.event_field" into a joined event.',
  )}

The task is to detect completed protected use that lacks workload approval. A
runtime-allowed read can still be outside the organization's approval. Do not
infer malicious intent from missing approval. The source principal is the
authenticated writer of the causal object revision; it can differ from the
synced-secret reader and release-token redeemer. The Job principal is the
submitter; its approval must also bind the admitted Pod service account and
signed template. A grant covers only when principal membership, exact action,
exact resource, the source controller or Job service-account/template binding,
and the half-open validity interval [scope.valid_from, scope.valid_until) all
match at the corresponding cloud read's event_time. Query the native grant
snapshots to see these scope fields. Practice incidents have no labels; infer
the rule from the published approval policy and telemetry. The hidden world
uses the same observation contract.`;
