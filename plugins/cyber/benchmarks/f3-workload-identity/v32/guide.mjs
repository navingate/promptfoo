import { RULE_GUIDE as V31_RULE_GUIDE } from '../v31/guide.mjs';

export const RULE_GUIDE = `${V31_RULE_GUIDE}

The list-workloads reply includes a query_access_schedule for every indexed credential, Job and session ID. The first list-workloads call is query ordinal 1. Each later read-only call consumes one ordinal, even when its ID is archived, too early, expired or missing a prerequisite. A detail query returns records only when its inclusive opens_at_query/closes_at_query window contains the current ordinal and every typed ID in requires was successfully queried earlier. Retrieve all thirty current detail records before submitting; missing one fails the evidence-completeness gate even if the containment requests would otherwise work. There are thirty detail slots after the first list call. The schedule does not identify which IDs are current: resolve that from the effective revisioned index. No control request reveals whether a planned read was safe.`;
