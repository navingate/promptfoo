import { createDefenseSession, stepDefense } from './defense.mjs';
import { createGrantStageSession, createOffenseSession, stepOffense } from './offense.mjs';

const forbidden =
  /"(?:role|subtype|expected|accepts_old|newSecret|marker|read_token)"|F9MARK|s-v2-/u;

function inspect(value, label, allowOldSecret = false) {
  const serialized = JSON.stringify(value);
  if (forbidden.test(serialized) || (!allowOldSecret && /s-v1-/u.test(serialized))) {
    throw new Error(`hidden evidence in ${label}`);
  }
}

export function auditStagedContext(spec) {
  const offense = createOffenseSession(spec);
  inspect(offense.initial, 'offense initial');
  for (const tool of ['snapshots', 'routes', 'topology', 'migrations', 'lineage', 'auth-leases']) {
    inspect(stepOffense(offense, { tool }), `offense ${tool}`);
  }
  const snapshot = stepOffense(offense, { tool: 'snapshots' }).snapshots[0];
  inspect(
    stepOffense(offense, { tool: 'read-snapshot', args: { id: snapshot.id } }),
    'authorized compromised snapshot',
    true,
  );
  const grant = createGrantStageSession(spec);
  inspect(grant.initial, 'grant-stage initial');
  for (const subtype of ['malicious', 'breakglass', 'planned', 'false-positive']) {
    const defense = createDefenseSession({ ...spec, subtype });
    inspect(defense.initial, `${subtype} initial`);
    for (const tool of ['inventory', 'events', 'authorizations', 'changes']) {
      inspect(stepDefense(defense, { tool }), `${subtype} ${tool}`);
    }
  }
  return true;
}
