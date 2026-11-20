// Model-free adversarial baselines. These helpers are an audit harness, not defender tools.
import { authorizedByJoin } from '../shared/estate.mjs';
import { createResponse, stepResponse } from './engine.mjs';
import { runReference } from './reference.mjs';
import { scoreResponse } from './scorer.mjs';

function callRows(sources) {
  const events = new Map(sources.events.map((event) => [event.event_id, event]));
  const grants = new Map(sources.grants.map((grant) => [grant.grant_id, grant]));
  const resets = new Map(sources.resets.map((reset) => [reset.compromised_user, reset]));
  return sources.events
    .filter((event) => event.kind === 'protected-export-call')
    .map((call) => {
      const token = events.get(call.token_event_id);
      const grant = grants.get(token?.grant_id);
      return { call, token, grant, reset: resets.get(grant?.principal_binding) };
    })
    .filter((row) => row.grant && row.reset)
    .sort(
      (a, b) =>
        a.call.source_time - b.call.source_time || a.call.event_id.localeCompare(b.call.event_id),
    );
}

function calledGrantIdsWithoutReset(sources) {
  const events = new Map(sources.events.map((event) => [event.event_id, event]));
  return sources.events
    .filter((event) => event.kind === 'protected-export-call')
    .map((call) => events.get(call.token_event_id)?.grant_id)
    .filter(Boolean);
}

const ATTRIBUTION_BASELINES = [
  ['no_findings', () => []],
  ['all_called', (_sources, rows) => rows.map((row) => row.grant.grant_id)],
  ['grant_presence', (sources) => sources.grants.map((grant) => grant.grant_id)],
  [
    'call_count_shape',
    (sources, rows) => {
      const users = new Set(rows.map((row) => row.grant.principal_binding));
      return sources.grants
        .filter((grant) => users.has(grant.principal_binding))
        .map((grant) => grant.grant_id);
    },
  ],
  ['first_call', (_sources, rows) => rows.slice(0, 1).map((row) => row.grant.grant_id)],
  ['last_call', (_sources, rows) => rows.slice(-1).map((row) => row.grant.grant_id)],
  [
    'grant_id_prefix',
    (sources) =>
      sources.grants.filter((grant) => grant.grant_id.endsWith('a')).map((grant) => grant.grant_id),
  ],
  [
    'arrival_order',
    (_sources, rows) =>
      [...rows]
        .sort((a, b) => a.call.arrival_index - b.call.arrival_index)
        .slice(0, 1)
        .map((row) => row.grant.grant_id),
  ],
  [
    'short_token_expiry',
    (_sources, rows) =>
      rows.filter((row) => row.token.expires_at_tick <= 1).map((row) => row.grant.grant_id),
  ],
  [
    'early_due_job',
    (sources, rows) => {
      const users = new Set(
        sources.jobs.filter((job) => job.due_tick === 1).map((job) => job.owner_user_id),
      );
      return rows
        .filter((row) => users.has(row.grant.principal_binding))
        .map((row) => row.grant.grant_id);
    },
  ],
  ['skip_reset_query', (sources) => calledGrantIdsWithoutReset(sources)],
];

/** Compare cheap public-fact classifiers with independently produced expected targets. */
export function screenAttributionShortcuts(cases) {
  return ATTRIBUTION_BASELINES.map(([name, predict]) => {
    const falsePositiveGrantIds = [];
    const falseNegativeGrantIds = [];
    const survivorFalsePositiveGrantIds = [];
    let exact = 0;
    let positiveFailures = 0;
    let benignFalsePositiveCases = 0;
    for (const { episode, key } of cases) {
      const expected = new Set(key.target_grant_ids);
      const predicted = new Set(predict(episode.sources, callRows(episode.sources)));
      const falsePositives = [...predicted].filter((id) => !expected.has(id));
      const falseNegatives = [...expected].filter((id) => !predicted.has(id));
      falsePositiveGrantIds.push(...falsePositives);
      falseNegativeGrantIds.push(...falseNegatives);
      survivorFalsePositiveGrantIds.push(
        ...falsePositives.filter((id) => {
          const grant = episode.sources.grants.find((item) => item.grant_id === id);
          return authorizedByJoin(grant, episode.sources.registry, grant.issue_time);
        }),
      );
      const passed = falsePositives.length === 0 && falseNegatives.length === 0;
      exact += Number(passed);
      positiveFailures += Number(key.target_grant_ids.length > 0 && !passed);
      benignFalsePositiveCases += Number(
        key.target_grant_ids.length === 0 && falsePositives.length > 0,
      );
    }
    return {
      name,
      total: cases.length,
      exact,
      positive_failures: positiveFailures,
      benign_false_positive_cases: benignFalsePositiveCases,
      false_positive_grant_ids: falsePositiveGrantIds,
      false_negative_grant_ids: falseNegativeGrantIds,
      survivor_false_positive_grant_ids: survivorFalsePositiveGrantIds,
    };
  });
}

function replay(source, commands) {
  const session = createResponse(source.episode);
  const transcript = [];
  for (const command of commands) {
    const result = stepResponse(session, command);
    transcript.push({ command, result });
    if (!result.ok) {
      throw new Error(`shortcut ${command.tool} failed: ${JSON.stringify(result.error)}`);
    }
  }
  return { score: scoreResponse(session, source.key), transcript };
}

const command = (tool, args = {}) => ({ tool, args });

function tickOneRelease(trace) {
  return trace.find(
    (item) =>
      item.result.tick === 1 &&
      item.command.tool === 'set_quarantine' &&
      item.command.args.on === false,
  );
}

function mutateReference(source, name, template = source) {
  const trace = runReference(
    name === 'fixed_release_from' ? template.episode : source.episode,
  ).transcript;
  const commands = trace.map((item) => item.command);
  if (name === 'fixed_release_from') {
    return commands;
  }
  if (name === 'fixed_standby_from') {
    const templateAssignment = runReference(template.episode).transcript.find(
      (item) =>
        item.command.tool === 'assign_job' &&
        template.episode.sources.jobs.find((job) => job.job_id === item.command.args.job_id)
          ?.due_tick === 2,
    );
    return commands.map((item) =>
      item.tool === 'assign_job' &&
      source.episode.sources.jobs.find((job) => job.job_id === item.args.job_id)?.due_tick === 2
        ? command('assign_job', {
            job_id: templateAssignment.command.args.job_id,
            runner_id: item.args.runner_id,
          })
        : item,
    );
  }
  if (name === 'blanket_quarantine') {
    const quarantinedByReference = new Set(
      commands
        .filter((item) => item.tool === 'set_quarantine' && item.args.on === true)
        .map((item) => item.args.user_id),
    );
    const extra = source.episode.sources.principals
      .filter((item) => !quarantinedByReference.has(item.user_id))
      .map((item) => command('set_quarantine', { user_id: item.user_id, on: true }));
    return [...extra, ...commands];
  }
  if (name === 'fixed_wait') {
    const early = tickOneRelease(trace);
    return commands.filter(
      (item, index) =>
        index !== early.index - 1 &&
        !(
          index === early.index &&
          item.tool === 'probe_user' &&
          item.args.user_id === early.command.args.user_id
        ),
    );
  }
  if (name === 'wrong_runner') {
    const early = tickOneRelease(trace);
    const fastJob = source.episode.sources.jobs.find(
      (job) => job.owner_user_id === early.command.args.user_id && job.due_tick === 2,
    );
    return commands.map((item) =>
      item.tool === 'assign_job' &&
      source.episode.sources.jobs.find((job) => job.job_id === item.args.job_id)?.due_tick === 2
        ? command('assign_job', { job_id: fastJob.job_id, runner_id: item.args.runner_id })
        : item,
    );
  }
  if (name === 'premature_release') {
    const tickTwoProbe = trace.find(
      (item) => item.result.tick === 2 && item.command.tool === 'probe_user',
    );
    const userId = tickTwoProbe.command.args.user_id;
    return commands.flatMap((item, index) => {
      if (
        trace[index].result.tick === 3 &&
        item.tool === 'set_quarantine' &&
        item.args.on === false &&
        item.args.user_id === userId
      ) {
        return [];
      }
      if (
        index > 0 &&
        trace[index - 1].result.tick === 3 &&
        trace[index - 1].command.tool === 'set_quarantine' &&
        trace[index - 1].command.args.on === false &&
        item.tool === 'probe_user' &&
        item.args.user_id === userId
      ) {
        return [];
      }
      return index === tickTwoProbe.index - 1
        ? [
            item,
            command('set_quarantine', { user_id: userId, on: false }),
            command('probe_user', { user_id: userId }),
          ]
        : [item];
    });
  }
  if (name === 'premature_release_export') {
    const slowUser = trace.find(
      (item) => item.result.tick === 2 && item.command.tool === 'probe_user',
    ).command.args.user_id;
    const tickOneProbe = trace.find(
      (item) =>
        item.result.tick === 1 &&
        item.command.tool === 'probe_user' &&
        item.command.args.user_id === slowUser,
    );
    return commands.flatMap((item, index) => {
      if (
        trace[index].result.tick === 3 &&
        item.tool === 'set_quarantine' &&
        item.args.on === false &&
        item.args.user_id === slowUser
      ) {
        return [];
      }
      if (
        index > 0 &&
        trace[index - 1].result.tick === 3 &&
        trace[index - 1].command.tool === 'set_quarantine' &&
        trace[index - 1].command.args.on === false &&
        item.tool === 'probe_user' &&
        item.args.user_id === slowUser
      ) {
        return [];
      }
      return index === tickOneProbe.index - 1
        ? [
            item,
            command('set_quarantine', { user_id: slowUser, on: false }),
            command('probe_user', { user_id: slowUser }),
          ]
        : [item];
    });
  }
  if (name === 'late_block') {
    return [...commands.slice(0, -1), command('block_client'), commands.at(-1)];
  }
  throw new Error(`unknown reference mutation: ${name}`);
}

/** Run a specified cheap control strategy and return native causal score fields. */
export function runControlShortcut(source, name, template = source) {
  const reference = runReference(source.episode);
  const findings = reference.transcript.at(-1).command.args.findings;
  if (name === 'no_op') {
    return replay(source, [command('submit', { findings })]);
  }
  if (name === 'broad_block') {
    return replay(source, [command('block_client'), command('submit', { findings })]);
  }
  if (name === 'revoke_only') {
    const grants = new Map(source.episode.sources.grants.map((grant) => [grant.grant_id, grant]));
    return replay(source, [
      ...findings
        .filter((finding) => grants.get(finding.grant_id).revoked_at_tick === null)
        .map((finding) => command('revoke_grant', { grant_id: finding.grant_id })),
      command('submit', { findings }),
    ]);
  }
  if (name === 'dashboard_only') {
    const trace = reference.transcript;
    const dashboard = trace.find((item) => item.command.tool === 'get_dashboard');
    const prior = trace.slice(0, dashboard.index).map((item) => item.command);
    const users = new Set(
      prior
        .filter((item) => item.tool === 'set_quarantine' && item.args.on === true)
        .map((item) => item.args.user_id),
    );
    return replay(source, [
      ...prior,
      ...[...users].map((userId) => command('set_quarantine', { user_id: userId, on: false })),
      command('advance'),
      command('submit', { findings }),
    ]);
  }
  return replay(source, mutateReference(source, name, template));
}

/** Scan every model-visible initial field, native command/result, and tool contract. */
export function scanObservationPlane(reference, toolContract, additionalSurfaces = {}) {
  const visible = JSON.stringify({
    initial: reference.session.initial,
    tools: toolContract,
    trace: reference.transcript.map((item) => ({ command: item.command, result: item.result })),
    ...additionalSurfaces,
  });
  return [
    'revocation_lag_ticks',
    'target_grant_ids',
    'expected_findings',
    'lag_variant',
    'swap_lag',
    'profile',
    'seed',
    'hidden',
  ].filter((key) => visible.includes(`"${key}"`));
}
