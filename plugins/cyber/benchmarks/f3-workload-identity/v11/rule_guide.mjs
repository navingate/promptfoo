import { RULE_GUIDE as V10_RULE_GUIDE } from '../v10/rule_guide.mjs';

// Format guidance only. The hidden world, joins, authorization choices, and scorer are v10.
export const RULE_GUIDE = V10_RULE_GUIDE.replace(
  'You may send one or several newline-separated commands; each consumes the same action budget.',
  'Send exactly one JSON tool command per response. Wait for its result before sending the next command. Do not concatenate commands or add prose.',
).replace(
  'No prose or markdown.',
  'No prose or markdown. For the final command, close the rule, args, and command objects: {"tool":"submit-rule","args":{"rule":{"version":1,"correlationOrder":"CHOOSE_ORDER","joins":{},"authorization":{}}}}. This is a shape example only: choose the order and fill every required join and authorization field from training evidence before submitting.',
);
