import { RULE_GUIDE as V28_RULE_GUIDE } from '../v28/guide.mjs';

export const RULE_GUIDE = `${V28_RULE_GUIDE}

Check each grant's inclusive start and exclusive expiry against the individual planned read time. A grant can start or expire between the active read and its renewal; approval for one phase does not imply approval for the other.`;
