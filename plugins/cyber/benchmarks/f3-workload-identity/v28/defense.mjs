import {
  buildDefenseSession as buildV23DefenseSession,
  referenceDefense as referenceV23Defense,
  scoreDefense as scoreV23Defense,
  stepDefense as stepV23Defense,
} from '../v23/defense.mjs';
import { replayContainment } from '../v24/runtime.mjs';
import { buildEpisode } from './producer.mjs';

export function buildDefenseSession(spec) {
  return buildV23DefenseSession(spec, {
    producer: buildEpisode,
    replay: replayContainment,
    actionBudget: 14,
  });
}

export function stepDefense(session, command) {
  return stepV23Defense(session, command);
}

export function scoreDefense(session) {
  return scoreV23Defense(session);
}

export function referenceDefense(session) {
  return referenceV23Defense(session);
}
