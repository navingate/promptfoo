import { RULE_GUIDE as V11_RULE_GUIDE } from '../v11/rule_guide.mjs';

// The syntax remains v10/v11; only the v13 matching semantics differ.
export const RULE_GUIDE = V11_RULE_GUIDE.replace(
  'The interpreter requires unique stage matches and causal order.',
  'The interpreter follows bounded complete causal paths and requires one unique final source-fetch proof, Job-read proof, and label per incident. Intermediate stages may have multiple legitimate candidates; later events must resolve them. Causal order remains required.',
);
