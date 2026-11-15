import {
  buildDefenseSession as buildV10DefenseSession,
  scoreDefense,
  stepDefense,
} from '../v10/defense.mjs';
import { REFERENCE_RULE_PER_READ_V3 } from '../v10/rule.mjs';

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
    approvalContext: true,
    perReadApproval: true,
    dualApprovalRevision: true,
  });
}

export function referenceDefense() {
  return structuredClone(REFERENCE_RULE_PER_READ_V3);
}
