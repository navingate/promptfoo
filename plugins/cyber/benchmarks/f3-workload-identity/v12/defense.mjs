import {
  buildDefenseSession as buildV10DefenseSession,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from '../v10/defense.mjs';

export { referenceDefense, scoreDefense, stepDefense };

export function buildDefenseSession(spec) {
  return buildV10DefenseSession({ ...spec, linkAmbiguity: true });
}
