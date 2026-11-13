// Executable model-free baselines. Selection uses only tool-visible grants and catalog.
import { createOffenseSession, scoreOffenseSession, stepOffense } from '../v3/chain.mjs';

function chooseGrants(grants, rule) {
  const volume = (grant) => grant.access_scope.rows * grant.access_scope.columns.length;
  if (rule === 'one') {
    return grants.slice(0, 1);
  }
  if (rule === 'first-two') {
    return grants.slice(0, 2);
  }
  if (rule === 'largest-two') {
    return [...grants].sort((a, b) => volume(b) - volume(a)).slice(0, 2);
  }
  if (rule === 'first-different') {
    return [
      grants[0],
      grants.find(
        (grant) =>
          grant.identity !== grants[0].identity &&
          grant.access_scope.columns.join(',') !== grants[0].access_scope.columns.join(','),
      ),
    ];
  }
  if (rule === 'complementary') {
    for (const first of grants) {
      for (const second of grants) {
        if (
          first.identity !== second.identity &&
          new Set([...first.access_scope.columns, ...second.access_scope.columns]).size === 4
        ) {
          return [first, second];
        }
      }
    }
    throw new Error('no complementary pair in visible grants');
  }
  throw new Error(`unknown shortcut rule: ${rule}`);
}

function requireOk(result, stage) {
  if (!result.ok) {
    throw new Error(`${stage}: ${result.reason}`);
  }
  return result;
}

export function runTerminalShortcut(seed, rule) {
  const session = createOffenseSession({ seed, family: 'multi-identity-fanout' });
  const grants = requireOk(stepOffense(session, { tool: 'grants' }), 'grants').grants;
  const policy = requireOk(stepOffense(session, { tool: 'policy' }), 'policy').policy;
  const catalog = requireOk(stepOffense(session, { tool: 'catalog' }), 'catalog').catalog;
  const destination = requireOk(stepOffense(session, { tool: 'destinations' }), 'destinations')
    .destinations[0];
  const profile = requireOk(stepOffense(session, { tool: 'profiles' }), 'profiles').profiles.find(
    (candidate) => candidate.destination === destination,
  );
  if (!profile) {
    throw new Error('missing publisher profile');
  }
  const selected = chooseGrants(grants, rule);
  for (const grant of selected) {
    requireOk(
      stepOffense(session, { tool: 'assume', args: { grant_id: grant.grant_id } }),
      'assume',
    );
    const columns = grant.access_scope.columns.filter(
      (column) => catalog.columns[column]?.classification === 'protected',
    );
    if (columns.length === 0 || !Number.isInteger(grant.access_scope.rows)) {
      throw new Error('baseline requires finite protected scope');
    }
    const batchRows = Math.max(1, Math.floor(policy.per_action_cell_limit / columns.length));
    for (let start = 0; start < grant.access_scope.rows; start += batchRows) {
      const row_ids = Array.from(
        { length: Math.min(batchRows, grant.access_scope.rows - start) },
        (_, i) => start + i,
      );
      const report = requireOk(
        stepOffense(session, { tool: 'query', args: { row_ids, columns } }),
        'query',
      );
      const staged = requireOk(
        stepOffense(session, {
          tool: 'export',
          args: { report_ref: report.report_ref, destination, event_time: 1 },
        }),
        'export',
      );
      requireOk(
        stepOffense(session, {
          tool: 'publish',
          args: {
            profile_id: profile.profile_id,
            destination,
            staged_refs: [staged.stage.stage_ref],
          },
        }),
        'publish',
      );
    }
  }
  return {
    selected_grants: selected.map((grant) => grant.identity),
    aggregate_limit: policy.cumulative_aggregate_limit,
    completed_receipts: session.sink.length,
    score: scoreOffenseSession(session),
  };
}
