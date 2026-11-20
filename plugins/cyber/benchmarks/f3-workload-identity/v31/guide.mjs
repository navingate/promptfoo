import { RULE_GUIDE as V30_RULE_GUIDE } from '../v30/guide.mjs';

export const RULE_GUIDE = `${V30_RULE_GUIDE}

The initial containment_cohorts catalog lists every indexed Job UID and session access-key reference, including archive IDs. Each quarantine-cohort request applies its listed selectors: it pauses current Jobs and denies current issued sessions; archive selectors have no effect. A selected approved current Job or session is collateral failure. Cohorts may overlap. Use the visible read-only records to find the exact unsafe controls, then select safe cohorts and individual controls within seven total requests. Tool acceptance confirms only the request, not the read outcome.`;
