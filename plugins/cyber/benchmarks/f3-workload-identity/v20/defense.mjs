import {
  buildDefenseSession as buildResponseSession,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from '../v18/defense.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { buildEpisode } from './producer.mjs';
import { planReferenceContainment } from './reference.mjs';

export { referenceDefense, scoreDefense, stepDefense };

export function buildDefenseSession(spec) {
  return buildResponseSession(spec, {
    producer: buildEpisode,
    replay: replayContainment,
    planner: planReferenceContainment,
    mission:
      'Contain future unsafe protected-object reads while preserving approved work sharing the cloud role. Investigate exact source provenance and both current Job approval lanes from the SOC view. Join the release token to its admitted Job and issued Pod/STS session; ignore unrelated source mappings. Submit one bounded action plan. Pausing does not kill issued sessions; denying one session does not stop renewal.',
  });
}
