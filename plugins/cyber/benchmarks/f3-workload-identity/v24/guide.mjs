import { RULE_GUIDE as V23_RULE_GUIDE } from '../v23/guide.mjs';

export const RULE_GUIDE = `${V23_RULE_GUIDE}

Evaluate the active issued-session read and the pending renewal read separately. The same Job can have a valid approval for one planned object and lack it for the other. Preserve every approved planned read, including one inside a Job that also has an unsafe read.`;
