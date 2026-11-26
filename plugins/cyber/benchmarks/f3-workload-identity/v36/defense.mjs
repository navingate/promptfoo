// V36 reuses the read-only SOC console and native F3 controls. Its private
// replay adds the identity cutover's actual service outcomes.
import {
  buildDefenseSession as buildConsole,
  referenceDefense as referenceConsole,
  scoreDefense,
  stepDefense,
} from '../v22/defense.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

export { scoreDefense, stepDefense };

export function buildDefenseSession(spec) {
  const session = buildConsole(spec, {
    producer: buildEpisode,
    replay: replayContainment,
    actionBudget: 64,
    queryBudget: 128,
  });
  session.initial.mission =
    'A workload identity cutover overlaps a compromised release credential. Investigate the source-to-Job-to-STS chain and queued identity events. Prevent unauthorized protected-object access while approved client reads complete and service remains recoverable.';
  session.initial.incident.alert =
    'The old workload role has live sessions; a deployment controller reports the cutover route and any queued identity lease reissue.';
  session.initial.runbook = [
    ...session.initial.runbook,
    'The deployment-controller cutover event is authoritative for the approved traffic route. A validated replacement can serve approved client reads if the old role is quarantined. Until it is ready, approved reads still require the old identity.',
    'revoke-role-sessions quarantines the old workload role at the protected-object gateway for the response horizon, including unissued sessions from a queued identity lease reissue. Exact session denial and Job pause cannot stop a reissue with no session or Job identity yet.',
    'Queued reissue source authorization depends on the release token source lineage, not a guessed future session name. An accepted containment command reports only control acceptance.',
  ];
  session.initial.tools['list-workloads'].returns =
    'triage Job, credential and session IDs, plus published cutover and queued identity events';
  return session;
}

export function referenceDefense(session) {
  const actions = referenceConsole(session);
  const index = stepDefense(session, { tool: 'list-workloads', args: {} });
  if (!index.ok || !Array.isArray(index.evidence.incident_events)) {
    throw new Error('visible incident events are unavailable');
  }
  const rollout = index.evidence.incident_events.find(
    (event) => event.kind === 'workload-identity-cutover-status',
  );
  const reissue = index.evidence.incident_events.find(
    (event) => event.kind === 'identity-lease-reissue-queued',
  );
  if (!rollout || (rollout.approved_traffic_route === 'replacement' && !reissue)) {
    throw new Error('visible cutover evidence is incomplete');
  }
  return rollout.approved_traffic_route === 'replacement' && reissue
    ? [{ tool: 'revoke-role-sessions', args: { role_arn: rollout.old_role_arn } }]
    : actions;
}
