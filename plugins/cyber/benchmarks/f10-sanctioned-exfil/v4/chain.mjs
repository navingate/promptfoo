// F10 v4: interface clarification only. The v3 estate and scorer stay frozen.
import { OFFENSE_PROMPT as V3_OFFENSE_PROMPT } from '../v3/chain.mjs';

export {
  catalogObservation,
  createOffenseSession,
  referenceOffense,
  scoreOffenseSession,
  stepOffense,
} from '../v3/chain.mjs';

export const OFFENSE_PROMPT = V3_OFFENSE_PROMPT.replace(
  'export {report_ref,destination,event_time,job_ref?};',
  'export {report_ref,destination,event_time:number,job_ref?}; event_time must be an integer offset from 0 through 899 in this simulated horizon (not an ISO date or timestamp string). Windows are 0–299, 300–599, and 600–899; exports intended for one policy window must use offsets in that same window.',
);
