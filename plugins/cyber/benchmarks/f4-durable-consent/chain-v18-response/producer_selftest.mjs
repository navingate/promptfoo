import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizedByJoin,
  BASE_POLICY,
  computeRevokedGrantIds,
  FAMILIES,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';

async function modules() {
  const config = await import('./config.mjs').catch(() => null);
  const producer = await import('./producer.mjs').catch(() => null);
  assert.ok(config, 'native response config.mjs is missing');
  assert.ok(producer, 'native response producer.mjs is missing');
  return { ...config, ...producer };
}

function byId(items, field) {
  return new Map(items.map((item) => [item[field], item]));
}

function sourceKeyNames(value, names = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => sourceKeyNames(item, names));
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) {
      names.add(name);
      sourceKeyNames(item, names);
    }
  }
  return names;
}

test('response grid has 36 unseen balanced incidents and hidden-lag branches', async () => {
  const { GRID } = await modules();
  assert.equal(GRID.length, 36);
  assert.deepEqual(
    GRID.map((item) => item.seed),
    Array.from({ length: 36 }, (_, index) => 42021 + index),
  );
  assert.deepEqual(
    Object.fromEntries(
      FAMILIES.map((family) => [family, GRID.filter((s) => s.family === family).length]),
    ),
    Object.fromEntries(FAMILIES.map((family) => [family, 9])),
  );
  assert.deepEqual(
    Object.fromEntries(
      ['benign', 'single-mint', 'both-live', 'mint-plus-session-only'].map((profile) => [
        profile,
        GRID.filter((s) => s.profile === profile).length,
      ]),
    ),
    { benign: 12, 'single-mint': 6, 'both-live': 12, 'mint-plus-session-only': 6 },
  );
  for (const profile of ['single-mint', 'both-live', 'mint-plus-session-only']) {
    const variants = GRID.filter((item) => item.profile === profile).map(
      (item) => item.lag_variant,
    );
    assert.equal(variants.filter((value) => value === 0).length, variants.length / 2);
    assert.equal(variants.filter((value) => value === 1).length, variants.length / 2);
  }
});

test('every native case validates and keeps the evaluator key out of serialized observations', async () => {
  const { GRID, produceResponse, validateResponseNative, RESPONSE_CONTRACT_ID } = await modules();
  for (const spec of GRID) {
    const { native, episode, key } = produceResponse(spec);
    assert.equal(native.contract_id, RESPONSE_CONTRACT_ID);
    assert.equal(native.provenance, 'estate-generated-reference');
    assert.deepEqual(native.public.base_policy, BASE_POLICY);
    assert.deepEqual(episode.sources, native.public);
    assert.notStrictEqual(episode.sources, native.public);
    assert.equal(episode.incident_id, native.incident_id);
    assert.equal(key.incident_id, native.incident_id);
    assert.equal(validateResponseNative(native).ok, true, `${spec.seed}/${spec.family}`);
    assert.equal(episode.initial.alert.client_id, native.public.client.client_id);
    assert.ok(
      native.public.events.some((event) => event.event_id === episode.initial.alert.call_event_id),
    );
    assert.equal(episode.initial.protected_scope, PROTECTED_SCOPE);
    const visible = JSON.stringify({ initial: episode.initial, sources: episode.sources });
    const visibleKeys = sourceKeyNames({ initial: episode.initial, sources: episode.sources });
    assert.ok(
      [...visibleKeys].every((name) => !name.startsWith('_')),
      `${spec.seed}: private source field`,
    );
    for (const forbidden of [
      'seed',
      'profile',
      'lag_variant',
      'swap_lag',
      'expected_findings',
      'target_grant_ids',
      'revocation_lag_ticks',
      'is_target',
      'score',
    ]) {
      assert.equal(visibleKeys.has(forbidden), false, `${spec.seed}: leaked ${forbidden}`);
    }
    assert.doesNotMatch(visible, /malicious-missed-by-query|same-user-survivor|expected_target/iu);
    assert.ok(!visible.includes(String(spec.seed)), `${spec.seed}: exposed seed`);
  }
});

test('all findings trace through post-reset tokens to user-bound grants and native creations', async () => {
  const { GRID, produceResponse } = await modules();
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const { grants, events, resets, registry } = native.public;
    const grantById = byId(grants, 'grant_id');
    const eventById = byId(events, 'event_id');
    const resetById = byId(resets, 'reset_event_id');
    assert.equal(new Set(events.map((event) => event.event_id)).size, events.length);
    assert.ok(
      events.some((event, index) => index > 0 && event.source_time < events[index - 1].source_time),
      `${spec.seed}: source time must differ from arrival order`,
    );
    const arrivalById = new Map(events.map((event) => [event.event_id, event.arrival_index]));
    assert.ok(
      events.every(
        (event) =>
          event.caused_by_event_id === null ||
          arrivalById.get(event.caused_by_event_id) < event.arrival_index,
      ),
      `${spec.seed}: causal parent must arrive before child`,
    );
    assert.equal(new Set(grants.map((grant) => grant.grant_id)).size, grants.length);
    assert.equal(new Set(resets.map((reset) => reset.reset_event_id)).size, resets.length);
    assert.equal(key.expected_findings.length, key.target_grant_ids.length);
    for (const finding of key.expected_findings) {
      const grant = grantById.get(finding.grant_id);
      const created = eventById.get(finding.created_event_id);
      const reset = resetById.get(finding.reset_event_id);
      const token = eventById.get(finding.token_event_id);
      const call = eventById.get(finding.call_event_id);
      assert.equal(created.kind, 'delegated-grant-created');
      assert.equal(created.grant_id, grant.grant_id);
      assert.equal(created.principal_binding, grant.principal_binding);
      assert.equal(reset.compromised_user, grant.principal_binding);
      assert.equal(token.kind, 'access-token-issued');
      assert.equal(token.grant_id, grant.grant_id);
      assert.equal(token.created_event_id, created.event_id);
      assert.equal(token.reset_event_id, reset.reset_event_id);
      assert.equal(call.kind, 'protected-export-call');
      assert.equal(call.token_event_id, token.event_id);
      assert.equal(call.resource, PROTECTED_SCOPE);
      assert.ok(created.source_time < reset.reset_time);
      assert.ok(reset.reset_time < token.source_time);
      assert.ok(token.source_time < call.source_time);
      assert.equal(authorizedByJoin(grant, registry, grant.issue_time), false);
      assert.equal(reset.revoked_grant_ids.includes(grant.grant_id), false);
    }
    for (const reset of resets) {
      assert.deepEqual(
        [...reset.revoked_grant_ids].sort(),
        computeRevokedGrantIds(grants, registry, reset).sort(),
        `${spec.seed}/${spec.family}: reset query mismatch`,
      );
    }
  }
});

test('same-user approved survivors and revoked unauthorized grants are real near misses', async () => {
  const { GRID, produceResponse } = await modules();
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const { grants, registry, resets, events } = native.public;
    const byGrant = byId(grants, 'grant_id');
    for (const targetId of key.target_grant_ids) {
      const target = byGrant.get(targetId);
      const reset = resets.find((item) => item.compromised_user === target.principal_binding);
      const survivor = grants.find(
        (grant) =>
          grant.grant_id !== targetId &&
          grant.client_id === target.client_id &&
          grant.principal_binding === target.principal_binding &&
          grant.enumeration_facet === target.enumeration_facet &&
          authorizedByJoin(grant, registry, grant.issue_time),
      );
      assert.ok(survivor, `${spec.seed}: missing same-user approved survivor`);
      assert.equal(authorizedByJoin(target, registry, target.issue_time), false);
      assert.equal(reset.revoked_grant_ids.includes(target.grant_id), false);
      assert.equal(reset.revoked_grant_ids.includes(survivor.grant_id), false);
      const survivorTokenIds = new Set(
        events
          .filter(
            (event) => event.kind === 'access-token-issued' && event.grant_id === survivor.grant_id,
          )
          .map((event) => event.event_id),
      );
      assert.ok(
        events.some(
          (event) =>
            event.kind === 'protected-export-call' && survivorTokenIds.has(event.token_event_id),
        ),
      );
    }
    const revokedUnauthorized = grants.filter(
      (grant) =>
        !authorizedByJoin(grant, registry, grant.issue_time) &&
        resets.some((reset) => reset.revoked_grant_ids.includes(grant.grant_id)),
    );
    assert.ok(revokedUnauthorized.length >= 1);
    for (const grant of revokedUnauthorized) {
      const tokenIds = new Set(
        events
          .filter(
            (event) => event.kind === 'access-token-issued' && event.grant_id === grant.grant_id,
          )
          .map((event) => event.event_id),
      );
      assert.ok(
        !events.some(
          (event) => event.kind === 'protected-export-call' && tokenIds.has(event.token_event_id),
        ),
      );
    }
  }
});

test('benign alerts name approved exports and have no unauthorized post-reset finding', async () => {
  const { GRID, produceResponse } = await modules();
  for (const spec of GRID.filter((item) => item.profile === 'benign')) {
    const { native, episode, key } = produceResponse(spec);
    assert.deepEqual(key.target_grant_ids, []);
    assert.deepEqual(key.expected_findings, []);
    const alertCall = native.public.events.find(
      (event) => event.event_id === episode.initial.alert.call_event_id,
    );
    const alertToken = native.public.events.find(
      (event) => event.event_id === alertCall.token_event_id,
    );
    const grant = native.public.grants.find((item) => item.grant_id === alertToken.grant_id);
    assert.ok(alertCall.source_time > 1000);
    assert.equal(authorizedByJoin(grant, native.public.registry, grant.issue_time), true);
    assert.ok(native.public.jobs.some((job) => job.due_tick === 1));
    const blindInert = native.public.grants.find((candidate) => {
      const reset = native.public.resets.find(
        (item) => item.compromised_user === candidate.principal_binding,
      );
      return (
        reset &&
        candidate.enumeration_facet !== reset.defect_enumerated &&
        !reset.revoked_grant_ids.includes(candidate.grant_id) &&
        !authorizedByJoin(candidate, native.public.registry, candidate.issue_time)
      );
    });
    assert.ok(blindInert, `${spec.seed}: missing benign blind-spot near miss`);
    assert.equal(blindInert.revoked_at_tick, 0);
    assert.ok(!native.public.tokens.some((token) => token.grant_id === blindInert.grant_id));
    assert.ok(
      !native.public.sessions.some((session) =>
        native.public.tokens.some(
          (token) => token.token_id === session.token_id && token.grant_id === blindInert.grant_id,
        ),
      ),
    );
  }
});

test('benign controls match both-live principal, grant, call, and job volume', async () => {
  const { GRID, produceResponse } = await modules();
  for (const family of FAMILIES) {
    const benign = produceResponse(
      GRID.find((item) => item.family === family && item.profile === 'benign'),
    ).native.public;
    const both = produceResponse(
      GRID.find((item) => item.family === family && item.profile === 'both-live'),
    ).native.public;
    for (const name of ['principals', 'grants', 'resets', 'jobs']) {
      assert.equal(benign[name].length, both[name].length, `${family}: ${name} count shortcut`);
    }
    const countCalls = (source) =>
      source.events.filter((event) => event.kind === 'protected-export-call').length;
    assert.equal(countCalls(benign), countCalls(both), `${family}: protected-call volume shortcut`);
  }
});

test('both-live lag swaps keep the complete pre-tick-1 source view byte-identical', async () => {
  const { GRID, produceResponse } = await modules();
  for (const spec of GRID.filter((item) => item.profile === 'both-live')) {
    const original = produceResponse(spec);
    const swapped = produceResponse({ ...spec, swap_lag: true });
    assert.equal(JSON.stringify(original.episode.initial), JSON.stringify(swapped.episode.initial));
    assert.equal(JSON.stringify(original.episode.sources), JSON.stringify(swapped.episode.sources));
    assert.deepEqual(original.key.target_grant_ids, swapped.key.target_grant_ids);
    assert.deepEqual(Object.values(original.native.hidden.revocation_lag_ticks).sort(), [1, 2]);
    for (const grantId of original.key.mint_grant_ids) {
      assert.equal(
        original.native.hidden.revocation_lag_ticks[grantId] +
          swapped.native.hidden.revocation_lag_ticks[grantId],
        3,
      );
    }
    assert.equal(original.native.public.jobs.filter((job) => job.due_tick === 2).length, 2);
    assert.equal(original.native.public.runners.filter((runner) => runner.standby).length, 1);
    assert.equal(original.native.public.runners.find((runner) => runner.standby).capacity, 1);
  }
});

test('jobs and signed standby eligibility make each profile operationally distinct', async () => {
  const { GRID, produceResponse } = await modules();
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const { jobs, runners, runner_authorizations } = native.public;
    assert.equal(new Set(jobs.map((job) => job.job_id)).size, jobs.length);
    assert.equal(new Set(runners.map((runner) => runner.runner_id)).size, runners.length);
    assert.ok(jobs.every((job) => [1, 2, 4].includes(job.due_tick)));
    assert.ok(
      jobs.every((job) => runners.some((runner) => runner.runner_id === job.current_runner_id)),
    );
    assert.ok(runner_authorizations.every((row) => row.signature && row.job_id && row.runner_id));
    const eventById = byId(native.public.events, 'event_id');
    const grantById = byId(native.public.grants, 'grant_id');
    const jobById = byId(jobs, 'job_id');
    const runnerById = byId(runners, 'runner_id');
    for (const job of jobs) {
      const creation = eventById.get(job.source_event_id);
      const grantCreated = eventById.get(grantById.get(job.approved_grant_id).created_event_id);
      assert.equal(creation.caused_by_event_id, grantCreated.event_id);
      assert.ok(grantCreated.source_time < creation.source_time);
    }
    for (const row of runner_authorizations) {
      const issued = eventById.get(row.source_event_id);
      const jobCreated = eventById.get(jobById.get(row.job_id).source_event_id);
      const runnerRegistered = eventById.get(runnerById.get(row.runner_id).source_event_id);
      assert.equal(issued.caused_by_event_id, jobCreated.event_id);
      assert.ok(jobCreated.source_time < issued.source_time);
      assert.ok(runnerRegistered.source_time < issued.source_time);
    }
    if (spec.profile === 'single-mint' || spec.profile === 'mint-plus-session-only') {
      assert.ok(
        jobs.some((job) => job.due_tick === 1 && key.mint_user_ids.includes(job.owner_user_id)),
      );
      assert.ok(
        jobs.some((job) => job.due_tick === 4 && key.mint_user_ids.includes(job.owner_user_id)),
      );
    }
    if (spec.profile === 'mint-plus-session-only') {
      const sessionJob = jobs.find(
        (job) => job.due_tick === 1 && key.session_only_user_ids.includes(job.owner_user_id),
      );
      assert.ok(sessionJob);
      assert.ok(
        !runner_authorizations.some(
          (row) =>
            row.job_id === sessionJob.job_id && row.runner_id !== sessionJob.current_runner_id,
        ),
      );
    }
  }
});

test('native validation fails closed on malformed specifications and broken facts', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  assert.throws(
    () => produceResponse({ ...GRID[0], family: 'unknown' }),
    /invalid response spec/iu,
  );
  assert.throws(
    () => produceResponse({ ...GRID[0], profile: 'both-live' }),
    /invalid response spec/iu,
  );
  assert.throws(() => produceResponse({ ...GRID[0], surprise: true }), /invalid response spec/iu);
  const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const duplicate = structuredClone(native);
  duplicate.public.events[1].event_id = duplicate.public.events[0].event_id;
  assert.equal(validateResponseNative(duplicate).ok, false);
  const brokenCall = structuredClone(native);
  brokenCall.public.events.find((event) => event.kind === 'protected-export-call').token_event_id =
    'missing';
  assert.equal(validateResponseNative(brokenCall).ok, false);
  const badReset = structuredClone(native);
  badReset.public.resets[0].revoked_grant_ids = [];
  assert.equal(validateResponseNative(badReset).ok, false);
  const missingPolicy = structuredClone(native);
  missingPolicy.public.registry = [];
  assert.equal(validateResponseNative(missingPolicy).ok, false);
  const answerLeak = structuredClone(native);
  answerLeak.public.events[0].ground_truth = 'target';
  assert.equal(validateResponseNative(answerLeak).ok, false);
  const unknownGrantField = structuredClone(native);
  unknownGrantField.public.grants[0].answer = 'target';
  assert.equal(validateResponseNative(unknownGrantField).ok, false);
  const wrongResetPrincipal = structuredClone(native);
  const token = wrongResetPrincipal.public.events.find(
    (event) => event.kind === 'access-token-issued' && event.reset_event_id,
  );
  token.reset_event_id = wrongResetPrincipal.public.resets.find(
    (reset) =>
      reset.compromised_user !==
      wrongResetPrincipal.public.grants.find((grant) => grant.grant_id === token.grant_id)
        .principal_binding,
  ).reset_event_id;
  assert.equal(validateResponseNative(wrongResetPrincipal).ok, false);
  const alteredDashboard = structuredClone(native);
  alteredDashboard.public.dashboard_contract.reported_effective_after_request = false;
  assert.equal(validateResponseNative(alteredDashboard).ok, false);
  const alteredSignature = structuredClone(native);
  alteredSignature.public.runner_authorizations[0].signature = 'forged';
  assert.equal(validateResponseNative(alteredSignature).ok, false);
});

test('approval-route literal cannot identify the unauthorized post-reset calls', async () => {
  const { GRID, produceResponse } = await modules();
  let shortcutExact = 0;
  let positiveMisses = 0;
  let benignFalsePositives = 0;
  let approvedElevatedCalls = 0;
  let unauthorizedStandardCalls = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const { events, grants, registry, resets } = native.public;
    const eventById = byId(events, 'event_id');
    const grantById = byId(grants, 'grant_id');
    const resetByUser = byId(resets, 'compromised_user');
    const selected = [];
    for (const call of events.filter((event) => event.kind === 'protected-export-call')) {
      const token = eventById.get(call.token_event_id);
      const grant = grantById.get(token.grant_id);
      const reset = resetByUser.get(grant.principal_binding);
      if (!reset || call.source_time <= reset.reset_time) {
        continue;
      }
      const authorized = authorizedByJoin(grant, registry, grant.issue_time);
      approvedElevatedCalls += Number(
        authorized && grant.approval_route === 'self-service-elevated',
      );
      unauthorizedStandardCalls += Number(
        !authorized && grant.approval_route === 'self-service-standard',
      );
      if (grant.approval_route === 'self-service-elevated') {
        selected.push({
          grant_id: grant.grant_id,
          created_event_id: grant.created_event_id,
          reset_event_id: reset.reset_event_id,
          token_event_id: token.event_id,
          call_event_id: call.event_id,
        });
      }
    }
    const sortFindings = (items) =>
      [...items].sort((a, b) => a.call_event_id.localeCompare(b.call_event_id));
    if (
      JSON.stringify(sortFindings(selected)) === JSON.stringify(sortFindings(key.expected_findings))
    ) {
      shortcutExact += 1;
    }
    if (
      key.expected_findings.some(
        (finding) => !selected.some((item) => item.call_event_id === finding.call_event_id),
      )
    ) {
      positiveMisses += 1;
    }
    if (key.expected_findings.length === 0 && selected.length > 0) {
      benignFalsePositives += 1;
    }
  }
  assert.ok(approvedElevatedCalls > 0, 'approved elevated export must be a route near miss');
  assert.ok(
    unauthorizedStandardCalls > 0,
    'unauthorized standard export must be a route near miss',
  );
  assert.ok(positiveMisses > 0, 'route-only shortcut must miss a positive finding');
  assert.ok(benignFalsePositives > 0, 'route-only shortcut must flag a benign export');
  assert.ok(shortcutExact <= 12, `route-only shortcut solved ${shortcutExact}/36`);
});

test('scope-presence literal cannot identify the unauthorized post-reset calls', async () => {
  const { GRID, produceResponse } = await modules();
  let shortcutExact = 0;
  let approvedBroadScopeCalls = 0;
  let unauthorizedNarrowScopeCalls = 0;
  let benignFalsePositives = 0;
  let positiveMisses = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const { events, grants, registry, resets } = native.public;
    const eventById = byId(events, 'event_id');
    const grantById = byId(grants, 'grant_id');
    const resetByUser = byId(resets, 'compromised_user');
    const selected = [];
    for (const call of events.filter((event) => event.kind === 'protected-export-call')) {
      const token = eventById.get(call.token_event_id);
      const grant = grantById.get(token.grant_id);
      const reset = resetByUser.get(grant.principal_binding);
      if (!reset || call.source_time <= reset.reset_time) {
        continue;
      }
      const broad = grant.scopes.includes('reports.read');
      const authorized = authorizedByJoin(grant, registry, grant.issue_time);
      approvedBroadScopeCalls += Number(authorized && broad);
      unauthorizedNarrowScopeCalls += Number(!authorized && !broad);
      if (broad) {
        selected.push(call.event_id);
      }
    }
    const truth = key.expected_findings.map((finding) => finding.call_event_id);
    if (JSON.stringify(selected.sort()) === JSON.stringify(truth.sort())) {
      shortcutExact += 1;
    }
    benignFalsePositives += Number(truth.length === 0 && selected.length > 0);
    positiveMisses += Number(truth.some((id) => !selected.includes(id)));
  }
  assert.ok(approvedBroadScopeCalls > 0, 'approved broad-scope export must be a near miss');
  assert.ok(
    unauthorizedNarrowScopeCalls > 0,
    'unauthorized narrow-scope export must be a near miss',
  );
  assert.ok(benignFalsePositives > 0, 'scope-only shortcut must flag a benign export');
  assert.ok(positiveMisses > 0, 'scope-only shortcut must miss a positive finding');
  assert.ok(shortcutExact <= 12, `scope-only shortcut solved ${shortcutExact}/36`);
});

test('native validation rejects contradictory cross-record lineage and runner eligibility', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const invalid = [
    (copy) => {
      const session = copy.public.sessions[0];
      session.user_id = copy.public.principals.find(
        (item) => item.user_id !== session.user_id,
      ).user_id;
    },
    (copy) => {
      copy.public.tokens[0].client_id = 'other-client';
    },
    (copy) => {
      const job = copy.public.jobs[0];
      job.current_runner_id = copy.public.runners.find(
        (item) => !item.standby && item.user_id !== job.owner_user_id,
      ).runner_id;
    },
    (copy) => {
      copy.public.runner_authorizations[0].client_id = 'other-client';
    },
    (copy) => {
      const job = copy.public.jobs[0];
      copy.public.runner_authorizations = copy.public.runner_authorizations.filter(
        (item) => !(item.job_id === job.job_id && item.runner_id === job.current_runner_id),
      );
    },
  ];
  for (const mutate of invalid) {
    const copy = structuredClone(native);
    mutate(copy);
    assert.equal(validateResponseNative(copy).ok, false);
  }
});
