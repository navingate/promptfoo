import { RULE_GUIDE as V15_RULE_GUIDE } from '../v15/rule_guide.mjs';

export const RULE_GUIDE = `${V15_RULE_GUIDE.replace(
  'The interpreter follows bounded complete causal paths and requires one unique final source-fetch proof, Job-read proof, and label per incident. Intermediate stages may have multiple legitimate candidates; later events must resolve them. Causal order remains required.',
  'The interpreter follows bounded complete causal paths. It requires one unique source-fetch proof per release redemption and one unique Job-read and checkpoint proof for each completed read in that admitted Job. Multiple completed reads in one Job session are expected; intermediate stages may have multiple legitimate candidates, but causal order and exact read linkage remain required.',
)
  .replace(
    'The rule runs once on hidden incidents and is scored on all labels and the source and Job cloud-read event IDs it correlates.',
    'The rule runs once on hidden incidents and is scored on the source approval decision for each release redemption and the Job approval decision for each completed, release-linked cloud read. Exact source, Job-read, and checkpoint event proofs and complete read coverage are required.',
  )
  .replace(
    'The task is to detect completed protected use that lacks workload approval.',
    'The task is to detect each completed protected read that lacks workload approval.',
  )
  .replace(
    'The Job principal is the submitter; its approval must also bind the admitted Pod service account and signed template.',
    'The Job principal is the submitter; approval for each completed read must also bind the admitted Pod service account and signed template.',
  )}

A signed Job may read more than one protected tenant object under the same
Pod and cloud session. Evaluate the exact action, resource, and action-time
approval of each completed read separately. An approval for one object does
not authorize another object. Use release-token to submission lineage to
exclude independent scheduled Jobs. The practice world remains unlabeled,
and no per-read verdicts are shown. Submit one reusable version-2 rule, not
per-incident answers.`;
