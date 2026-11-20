import {
  buildDefenseSession as buildV23DefenseSession,
  referenceDefense as referenceV23Defense,
  scoreDefense as scoreV23Defense,
  stepDefense as stepV23Defense,
} from '../v23/defense.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

export function buildDefenseSession(spec) {
  const session = buildV23DefenseSession(spec, {
    producer: buildEpisode,
    replay: replayContainment,
  });
  session.initial.mission =
    'Investigate the simulated workload release incident. For each planned active and renewal protected-object read, prevent unauthorized reads while preserving every approved read. Submit a bounded containment plan.';
  session.initial.runbook.push(
    'Each admitted Job has a planned issued-session read and a pending renewal read. Their current approvals may differ by object and planned time. An approved read inside an otherwise unsafe Job still must complete; contain only the unsafe phase.',
  );
  return session;
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
