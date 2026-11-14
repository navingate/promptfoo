import { RULE_GUIDE as V13_RULE_GUIDE } from '../v13/rule_guide.mjs';

export const RULE_GUIDE = `${V13_RULE_GUIDE}

Some cross-system event kinds omit causal_ref because their native systems do
not share one request ID. Use the object, credential, workload, session,
resource, time, and checkpoint fields that appear in the queried evidence to
correlate them. The training and hidden worlds use the same observation
contract.`;
