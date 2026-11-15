import {
  buildDefenseSession as buildResponseSession,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from '../v18/defense.mjs';
import { buildEpisode } from './producer.mjs';
import { planReferenceContainment } from './reference.mjs';
import { replayContainment } from './runtime.mjs';

export { referenceDefense, scoreDefense, stepDefense };

export function buildDefenseSession(spec) {
  return buildResponseSession(spec, {
    producer: buildEpisode,
    replay: replayContainment,
    planner: planReferenceContainment,
    mission:
      'Contain future unsafe protected-object reads while preserving approved work sharing the cloud role. In this incident, a release credential is compromised when its causal source fetch completed from an object revision whose authenticated writer lacked source approval at fetch time. A downstream Job approval cannot make that credential trustworthy. Also assess both change and data-owner approval for each planned Job read. Join the exact source writer/revision and credential to the redeemed release token, admitted Job, Pod and issued session; ignore unrelated fetches. Submit one bounded action plan. Pausing does not kill issued sessions; exact session denial does not stop renewal.',
  });
}
