import {
  buildDefenseSession as buildResponseSession,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from '../v18/defense.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { buildEpisode } from './producer.mjs';

export { referenceDefense, scoreDefense, stepDefense };

export function buildDefenseSession(spec) {
  return buildResponseSession(spec, {
    producer: buildEpisode,
    replay: replayContainment,
    planner: planReferenceContainment,
    mission:
      'Investigate the observed F3 workload release and preserve authorized cloud work. Contain every future unauthorized protected-object read from a source-compromised credential or a Job lacking current exact approval. Use the pre-triage SOC view to join the release token, Job, Pod, STS session, source grant and current Job grants. Submit one bounded action plan. Pausing leaves issued sessions active; denying one session leaves renewal possible.',
  });
}
