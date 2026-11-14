import {
  buildDefenseSession as buildV10DefenseSession,
  scoreDefense,
  stepDefense,
} from '../v10/defense.mjs';
import { REFERENCE_RULE } from '../v10/rule.mjs';

export { scoreDefense, stepDefense };

export function buildDefenseSession(spec) {
  return buildV10DefenseSession({
    ...spec,
    sourceAmbiguity: true,
    sourceRevisionRace: true,
    linkAmbiguity: true,
    operationalCheckpoint: true,
    jobRenewal: true,
    matchMode: 'full-chain',
    projectionMode: 'cross-plane-deoracle',
  });
}

export function referenceDefense() {
  const rule = structuredClone(REFERENCE_RULE);
  rule.joins.sourceReconcile = rule.joins.sourceReconcile.filter(
    (clause) => clause.left !== 'causal_ref',
  );
  rule.joins.sourceWrite = rule.joins.sourceWrite.filter((clause) => clause.left !== 'causal_ref');
  rule.joins.request = rule.joins.request.filter((clause) => clause.left !== 'event_id');
  rule.joins.webSts = rule.joins.webSts.filter((clause) => clause.left !== 'event_id');
  rule.joins.roleSts = rule.joins.roleSts.filter((clause) => clause.left !== 'event_id');
  rule.joins.jobCloud = rule.joins.jobCloud.filter((clause) => clause.left !== 'event_id');
  return rule;
}
