import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizedByJoin,
  BASE_POLICY,
  computeRevokedGrantIds,
  entryValidAt,
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

function calledRowsForUser(publicFacts, userId) {
  const eventById = byId(publicFacts.events, 'event_id');
  const grantById = byId(publicFacts.grants, 'grant_id');
  const reset = publicFacts.resets.find((item) => item.compromised_user === userId);
  return publicFacts.events
    .filter(
      (event) => event.kind === 'protected-export-call' && event.source_time > reset.reset_time,
    )
    .map((call) => {
      const token = eventById.get(call.token_event_id);
      const grant = grantById.get(token.grant_id);
      return { call, token, grant, reset };
    })
    .filter((row) => row.grant.principal_binding === userId)
    .sort(
      (a, b) =>
        a.call.source_time - b.call.source_time || a.call.event_id.localeCompare(b.call.event_id),
    );
}

function citedFinding(row) {
  return {
    grant_id: row.grant.grant_id,
    created_event_id: row.grant.created_event_id,
    reset_event_id: row.reset.reset_event_id,
    token_event_id: row.token.event_id,
    call_event_id: row.call.event_id,
  };
}

function sameFindings(candidate, expected) {
  const ordered = (items) =>
    [...items].sort((a, b) => a.call_event_id.localeCompare(b.call_event_id));
  return JSON.stringify(ordered(candidate)) === JSON.stringify(ordered(expected));
}

function exactSelectors(row, grant) {
  return (
    row.client_or_app_selector === grant.client_id &&
    row.tenant_selector === grant.tenant &&
    row.principal_selector === grant.principal_binding &&
    JSON.stringify(row.scope_selector) === JSON.stringify(grant.scopes) &&
    row.approval_route_selector === grant.approval_route
  );
}

function selectorMatches(selector, value) {
  if (selector === '*') {
    return true;
  }
  if (Array.isArray(selector)) {
    return Array.isArray(value)
      ? value.every((item) => selector.includes(item))
      : selector.includes(value);
  }
  return Array.isArray(value) ? value.every((item) => item === selector) : selector === value;
}

function rowCoversExceptClient(row, grant) {
  return (
    selectorMatches(row.tenant_selector, grant.tenant) &&
    selectorMatches(row.principal_selector, grant.principal_binding) &&
    selectorMatches(row.scope_selector, grant.scopes) &&
    selectorMatches(row.approval_route_selector, grant.approval_route) &&
    entryValidAt(row, grant.issue_time)
  );
}

function appendManualRevocation(publicFacts, grant) {
  const reset = publicFacts.resets.find(
    (item) => item.compromised_user === grant.principal_binding,
  );
  const sourceTime = Math.max(...publicFacts.events.map((event) => event.source_time)) + 1;
  const arrivalTime = Math.max(
    sourceTime,
    Math.max(...publicFacts.events.map((event) => event.arrival_time)) + 1,
  );
  publicFacts.events.push({
    event_id: `evt_test_manual_revoke_${grant.grant_id}`,
    kind: 'delegated-grant-revoked',
    source_time: sourceTime,
    caused_by_event_id: reset.reset_event_id,
    arrival_time: arrivalTime,
    arrival_index: publicFacts.events.length,
    grant_id: grant.grant_id,
    client_id: grant.client_id,
    effective_tick: 0,
  });
}

function appendUnbackedEvent(publicFacts, kind) {
  const source = publicFacts.events.find((event) => event.kind === kind);
  assert.ok(source, `missing ${kind} source event`);
  publicFacts.events.push({
    ...source,
    event_id: `evt_test_unbacked_${kind}`,
    arrival_time: Math.max(...publicFacts.events.map((event) => event.arrival_time)) + 1,
    arrival_index: publicFacts.events.length,
  });
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

test('native control contract publishes the irreversible client-wide block', async () => {
  const { GRID, TOOL_CONTRACT, produceResponse } = await modules();
  const { episode, native } = produceResponse(GRID[0]);
  assert.deepEqual(TOOL_CONTRACT.block_client, []);
  assert.equal(
    episode.initial.control_contract.block_client,
    native.public.control_contract.block_client,
  );
  assert.ok(native.public.control_contract.block_client.includes('permanent'));
  assert.ok(native.public.control_contract.block_client.includes('approved jobs'));
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
    for (const name of ['principals', 'grants', 'registry', 'resets', 'jobs']) {
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

test('called-grant count and first or last call cannot reveal the findings', async () => {
  const { GRID, produceResponse } = await modules();
  const exact = { first: 0, last: 0 };
  const positiveMisses = { first: 0, last: 0 };
  const benignFalsePositives = { first: 0, last: 0 };
  let targetFirstGrant = 0;
  let targetLastGrant = 0;
  let callOrderMatchesGrantOrder = 0;
  let callOrderDiffersFromGrantOrder = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const groups = native.public.resets.map((reset) => {
      const rows = calledRowsForUser(native.public, reset.compromised_user);
      return [...new Map(rows.map((row) => [row.grant.grant_id, row])).values()];
    });
    assert.ok(
      groups.every((rows) => rows.length === 2),
      `${spec.seed}: distinct called grants`,
    );
    for (const rows of groups) {
      const target = rows.find((row) => key.target_grant_ids.includes(row.grant.grant_id));
      if (target) {
        const issueOrder = [...rows].sort((a, b) => a.grant.issue_time - b.grant.issue_time);
        targetFirstGrant += Number(issueOrder[0].grant.grant_id === target.grant.grant_id);
        targetLastGrant += Number(issueOrder[1].grant.grant_id === target.grant.grant_id);
        callOrderMatchesGrantOrder += Number(
          issueOrder[0].grant.grant_id === rows[0].grant.grant_id,
        );
        callOrderDiffersFromGrantOrder += Number(
          issueOrder[0].grant.grant_id !== rows[0].grant.grant_id,
        );
      }
    }
    for (const position of ['first', 'last']) {
      const candidate = groups.map((rows) =>
        citedFinding(position === 'first' ? rows[0] : rows[1]),
      );
      exact[position] += Number(sameFindings(candidate, key.expected_findings));
      positiveMisses[position] += Number(
        key.expected_findings.some(
          (finding) => !candidate.some((item) => item.call_event_id === finding.call_event_id),
        ),
      );
      benignFalsePositives[position] += Number(
        key.expected_findings.length === 0 && candidate.length > 0,
      );
    }
  }
  assert.ok(targetFirstGrant > 0 && targetLastGrant > 0, 'target position must vary');
  assert.ok(
    callOrderMatchesGrantOrder > 0 && callOrderDiffersFromGrantOrder > 0,
    'call order must vary independently of grant order',
  );
  for (const position of ['first', 'last']) {
    assert.ok(positiveMisses[position] > 0, `${position} shortcut must miss a target`);
    assert.ok(benignFalsePositives[position] > 0, `${position} shortcut must flag benign`);
    assert.ok(exact[position] <= 12, `${position} shortcut solved ${exact[position]}/36`);
  }
});

test('route and scope compound cannot replace the authorization join', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let positiveMisses = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const candidate = native.public.resets.flatMap((reset) => {
      const rows = [
        ...new Map(
          calledRowsForUser(native.public, reset.compromised_user).map((row) => [
            row.grant.grant_id,
            row,
          ]),
        ).values(),
      ];
      const sameRoute = new Set(rows.map((row) => row.grant.approval_route)).size === 1;
      return rows
        .filter((row) => row.grant.scopes.includes('reports.read') === sameRoute)
        .map(citedFinding);
    });
    exact += Number(sameFindings(candidate, key.expected_findings));
    positiveMisses += Number(
      key.expected_findings.some(
        (finding) => !candidate.some((item) => item.call_event_id === finding.call_event_id),
      ),
    );
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(positiveMisses > 0, 'compound must miss a positive finding');
  assert.ok(benignFalsePositives > 0, 'compound must flag a benign export');
  assert.ok(exact <= 12, `route/scope compound solved ${exact}/36`);
});

test('short-lived token alone cannot identify the unauthorized called grant', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let approvedShortLivedCalls = 0;
  let positiveFalsePositives = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidateRows = rows.filter((row) => row.token.expires_at_tick <= 1);
    const candidate = candidateRows.map(citedFinding);
    approvedShortLivedCalls += candidateRows.filter((row) =>
      authorizedByJoin(row.grant, native.public.registry, row.grant.issue_time),
    ).length;
    exact += Number(sameFindings(candidate, key.expected_findings));
    positiveFalsePositives += Number(
      key.expected_findings.length > 0 &&
        candidate.some(
          (item) =>
            !key.expected_findings.some((finding) => finding.call_event_id === item.call_event_id),
        ),
    );
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(approvedShortLivedCalls > 0, 'approved calls need short-lived token near misses');
  assert.ok(
    positiveFalsePositives > 0,
    'expiry shortcut must flag an approved call in a positive case',
  );
  assert.ok(benignFalsePositives > 0, 'expiry shortcut must flag a benign call');
  assert.ok(exact <= 12, `expiry shortcut solved ${exact}/36`);
});

test('short-lived token without an approved job cannot identify unauthorized calls', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let approvedShortLivedNoJobCalls = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidateRows = rows.filter(
      (row) =>
        row.token.expires_at_tick <= 1 &&
        !native.public.jobs.some((job) => job.approved_grant_id === row.grant.grant_id),
    );
    approvedShortLivedNoJobCalls += candidateRows.filter((row) =>
      authorizedByJoin(row.grant, native.public.registry, row.grant.issue_time),
    ).length;
    const candidate = candidateRows.map(citedFinding);
    exact += Number(sameFindings(candidate, key.expected_findings));
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(exact <= 24, `expiry-and-no-job shortcut solved ${exact}/36`);
  assert.ok(approvedShortLivedNoJobCalls > 0, 'approved no-job calls need short-lived tokens');
  assert.ok(benignFalsePositives > 0, 'expiry-and-no-job shortcut must flag benign calls');
});

test('no job and no valid exact row still flags authorized benign calls', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let approvedCallsSelected = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidateRows = rows.filter(
      (row) =>
        !native.public.jobs.some((job) => job.approved_grant_id === row.grant.grant_id) &&
        !native.public.registry.some(
          (entry) => exactSelectors(entry, row.grant) && entryValidAt(entry, row.grant.issue_time),
        ),
    );
    approvedCallsSelected += candidateRows.filter((row) =>
      authorizedByJoin(row.grant, native.public.registry, row.grant.issue_time),
    ).length;
    const candidate = candidateRows.map(citedFinding);
    exact += Number(sameFindings(candidate, key.expected_findings));
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(approvedCallsSelected > 0, 'compound must select authorized no-job calls');
  assert.ok(benignFalsePositives > 0, 'compound must false-positive on benign incidents');
  assert.ok(exact <= 29, `job-and-exact-row shortcut solved ${exact}/36`);
});

test('expired exact-selector row alone cannot identify unauthorized called grants', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let approvedExpiredExactCalls = 0;
  let positiveFalsePositives = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidateRows = rows.filter((row) =>
      native.public.registry.some(
        (entry) =>
          exactSelectors(entry, row.grant) &&
          entry.valid_until !== null &&
          entry.valid_until < row.grant.issue_time,
      ),
    );
    const candidate = candidateRows.map(citedFinding);
    approvedExpiredExactCalls += candidateRows.filter((row) =>
      authorizedByJoin(row.grant, native.public.registry, row.grant.issue_time),
    ).length;
    exact += Number(sameFindings(candidate, key.expected_findings));
    positiveFalsePositives += Number(
      key.expected_findings.length > 0 &&
        candidate.some(
          (item) =>
            !key.expected_findings.some((finding) => finding.call_event_id === item.call_event_id),
        ),
    );
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(approvedExpiredExactCalls > 0, 'approved calls need expired exact-row near misses');
  assert.ok(
    positiveFalsePositives > 0,
    'expired-row shortcut must flag an approved call in a positive case',
  );
  assert.ok(benignFalsePositives > 0, 'expired-row shortcut must flag a benign call');
  assert.ok(exact <= 12, `expired-row shortcut solved ${exact}/36`);
});

test('absence of a valid exact-selector row cannot replace the full authorization join', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let approvedWithoutValidExact = 0;
  let positiveFalsePositives = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidateRows = rows.filter(
      (row) =>
        !native.public.registry.some(
          (entry) => exactSelectors(entry, row.grant) && entryValidAt(entry, row.grant.issue_time),
        ),
    );
    const candidate = candidateRows.map(citedFinding);
    approvedWithoutValidExact += candidateRows.filter((row) =>
      authorizedByJoin(row.grant, native.public.registry, row.grant.issue_time),
    ).length;
    exact += Number(sameFindings(candidate, key.expected_findings));
    positiveFalsePositives += Number(
      key.expected_findings.length > 0 &&
        candidate.some(
          (item) =>
            !key.expected_findings.some((finding) => finding.call_event_id === item.call_event_id),
        ),
    );
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(approvedWithoutValidExact > 0, 'approved calls need non-exact valid covering rows');
  assert.ok(
    positiveFalsePositives > 0,
    'exact-row shortcut must flag an approved call in a positive case',
  );
  assert.ok(benignFalsePositives > 0, 'exact-row shortcut must flag a benign call');
  assert.ok(exact <= 12, `no-valid-exact-row shortcut solved ${exact}/36`);
});

test('valid scope-near-miss row presence cannot identify unauthorized called grants', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let approvedNearMissCalls = 0;
  let positiveFalsePositives = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidateRows = rows.filter((row) =>
      native.public.registry.some(
        (entry) =>
          entry.client_or_app_selector === row.grant.client_id &&
          entry.tenant_selector === row.grant.tenant &&
          entry.principal_selector === row.grant.principal_binding &&
          JSON.stringify(entry.scope_selector) === JSON.stringify(['reports.read']) &&
          entry.approval_route_selector === row.grant.approval_route &&
          entryValidAt(entry, row.grant.issue_time),
      ),
    );
    const candidate = candidateRows.map(citedFinding);
    approvedNearMissCalls += candidateRows.filter((row) =>
      authorizedByJoin(row.grant, native.public.registry, row.grant.issue_time),
    ).length;
    exact += Number(sameFindings(candidate, key.expected_findings));
    positiveFalsePositives += Number(
      key.expected_findings.length > 0 &&
        candidate.some(
          (item) =>
            !key.expected_findings.some((finding) => finding.call_event_id === item.call_event_id),
        ),
    );
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(approvedNearMissCalls > 0, 'approved calls need valid scope-near-miss rows');
  assert.ok(positiveFalsePositives > 0, 'scope-near row must flag approved positive call');
  assert.ok(benignFalsePositives > 0, 'scope-near row must flag benign call');
  assert.ok(exact <= 12, `scope-near-row shortcut solved ${exact}/36`);
});

test('array client and alternate-route row presence cannot identify unauthorized called grants', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let approvedNearMissCalls = 0;
  let positiveFalsePositives = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidateRows = rows.filter((row) =>
      native.public.registry.some(
        (entry) =>
          Array.isArray(entry.client_or_app_selector) &&
          entry.client_or_app_selector.includes(row.grant.client_id) &&
          entry.tenant_selector === row.grant.tenant &&
          entry.principal_selector === row.grant.principal_binding &&
          JSON.stringify(entry.scope_selector) === JSON.stringify(['reports.read']) &&
          entry.approval_route_selector !== row.grant.approval_route &&
          entryValidAt(entry, row.grant.issue_time),
      ),
    );
    const candidate = candidateRows.map(citedFinding);
    approvedNearMissCalls += candidateRows.filter((row) =>
      authorizedByJoin(row.grant, native.public.registry, row.grant.issue_time),
    ).length;
    exact += Number(sameFindings(candidate, key.expected_findings));
    positiveFalsePositives += Number(
      key.expected_findings.length > 0 &&
        candidate.some(
          (item) =>
            !key.expected_findings.some((finding) => finding.call_event_id === item.call_event_id),
        ),
    );
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(approvedNearMissCalls > 0, 'approved calls need array-route near-miss rows');
  assert.ok(positiveFalsePositives > 0, 'array-route row must flag an approved positive call');
  assert.ok(benignFalsePositives > 0, 'array-route row must flag a benign call');
  assert.ok(exact <= 12, `array-route-row shortcut solved ${exact}/36`);
});

test('omitting the client selector from the authorization join misses unauthorized calls', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let positiveMisses = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidate = rows
      .filter(
        (row) => !native.public.registry.some((entry) => rowCoversExceptClient(entry, row.grant)),
      )
      .map(citedFinding);
    exact += Number(sameFindings(candidate, key.expected_findings));
    positiveMisses += Number(
      key.expected_findings.some(
        (finding) => !candidate.some((item) => item.call_event_id === finding.call_event_id),
      ),
    );
  }
  assert.ok(exact <= 12, `client-omitted join solved ${exact}/36`);
  assert.ok(positiveMisses > 0, 'client-omitted join must miss unauthorized calls');
});

test('wrong-client otherwise-covering row alone cannot identify unauthorized called grants', async () => {
  const { GRID, produceResponse } = await modules();
  let exact = 0;
  let positiveFalsePositives = 0;
  let benignFalsePositives = 0;
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const candidate = rows
      .filter((row) =>
        native.public.registry.some(
          (entry) =>
            rowCoversExceptClient(entry, row.grant) &&
            !selectorMatches(entry.client_or_app_selector, row.grant.client_id),
        ),
      )
      .map(citedFinding);
    exact += Number(sameFindings(candidate, key.expected_findings));
    positiveFalsePositives += Number(
      key.expected_findings.length > 0 &&
        candidate.some(
          (item) =>
            !key.expected_findings.some((finding) => finding.call_event_id === item.call_event_id),
        ),
    );
    benignFalsePositives += Number(key.expected_findings.length === 0 && candidate.length > 0);
  }
  assert.ok(positiveFalsePositives > 0, 'wrong-client row must flag approved positive calls');
  assert.ok(benignFalsePositives > 0, 'wrong-client row must flag benign calls');
  assert.ok(exact <= 12, `wrong-client-row shortcut solved ${exact}/36`);
});

test('client-omitted covering-row count cannot identify unauthorized called grants', async () => {
  const { GRID, produceResponse } = await modules();
  const cases = [];
  const approvedCounts = new Set();
  const unauthorizedCounts = new Set();
  for (const spec of GRID) {
    const { native, key } = produceResponse(spec);
    const rows = native.public.resets.flatMap((reset) =>
      calledRowsForUser(native.public, reset.compromised_user),
    );
    const counted = rows.map((row) => ({
      row,
      count: native.public.registry.filter((entry) => rowCoversExceptClient(entry, row.grant))
        .length,
    }));
    for (const { row, count } of counted) {
      const bucket = authorizedByJoin(row.grant, native.public.registry, row.grant.issue_time)
        ? approvedCounts
        : unauthorizedCounts;
      bucket.add(count);
    }
    cases.push({ counted, expected: key.expected_findings });
  }
  const maxCount = Math.max(...cases.flatMap(({ counted }) => counted.map((item) => item.count)));
  const maxExact = Math.max(
    ...Array.from({ length: maxCount + 1 }, (_, count) =>
      cases.reduce(
        (exact, { counted, expected }) =>
          exact +
          Number(
            sameFindings(
              counted.filter((item) => item.count === count).map((item) => citedFinding(item.row)),
              expected,
            ),
          ),
        0,
      ),
    ),
  );
  assert.ok(maxExact <= 12, `best client-omitted-row-count shortcut solved ${maxExact}/36`);
  assert.ok(
    [...unauthorizedCounts].some((count) => approvedCounts.has(count)),
    'client-omitted covering-row counts must overlap across authorization states',
  );
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

test('both-live lag assignment balances the actual fast user and swaps the twin', async () => {
  const { GRID, produceResponse } = await modules();
  const fastByUserPosition = [0, 0];
  for (const spec of GRID.filter((item) => item.profile === 'both-live')) {
    const { native } = produceResponse(spec);
    const { native: swapped } = produceResponse({ ...spec, swap_lag: true });
    const grants = byId(native.public.grants, 'grant_id');
    const fastGrantId = Object.entries(native.hidden.revocation_lag_ticks).find(
      ([, ticks]) => ticks === 1,
    )?.[0];
    const swappedFastGrantId = Object.entries(swapped.hidden.revocation_lag_ticks).find(
      ([, ticks]) => ticks === 1,
    )?.[0];
    const fastUser = grants.get(fastGrantId)?.principal_binding;
    const swappedFastUser = grants.get(swappedFastGrantId)?.principal_binding;
    const position = native.public.resets.findIndex((reset) => reset.compromised_user === fastUser);
    assert.ok(position >= 0, 'fast propagation must belong to an affected user');
    assert.notEqual(fastUser, swappedFastUser, 'lag twin must reverse the fast user');
    fastByUserPosition[position] += 1;
  }
  assert.deepEqual(fastByUserPosition, [6, 6]);
});

test('native validation rejects nonempty initial delivery records', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID[0]);
  const leaked = structuredClone(native);
  leaked.public.delivery_records.push({ answer: 'target' });
  assert.equal(validateResponseNative(leaked).reason, 'public source shape or answer leak');
});

test('native validation rejects reset event and canonical runbook drift', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID[0]);
  const changes = [
    (copy) => {
      copy.public.resets[0].query_runbook = 'Different remediation query';
    },
    (copy) => {
      const reset = copy.public.resets[0];
      byId(copy.public.events, 'event_id').get(reset.reset_event_id).query_relationship =
        FAMILIES.find((family) => family !== reset.query_relationship);
    },
    (copy) => {
      const reset = copy.public.resets[0];
      byId(copy.public.events, 'event_id').get(reset.reset_event_id).defect_enumerated =
        'wrong-facet';
    },
    (copy) => {
      const reset = copy.public.resets[0];
      byId(copy.public.events, 'event_id').get(reset.reset_event_id).password_reset = false;
    },
    (copy) => {
      const reset = copy.public.resets[0];
      byId(copy.public.events, 'event_id').get(reset.reset_event_id).sessions_revoked = false;
    },
  ];
  for (const change of changes) {
    const copy = structuredClone(native);
    change(copy);
    assert.equal(validateResponseNative(copy).reason, 'reset query or native event mismatch');
  }
});

test('affected post-reset token must cite its reset before a finding can be sourced', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native, key } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const copy = structuredClone(native);
  byId(copy.public.events, 'event_id').get(key.expected_findings[0].token_event_id).reset_event_id =
    null;
  assert.equal(validateResponseNative(copy).reason, 'token lineage');
});

test('reset-revoked grants cannot issue fresh post-reset tokens; later manual revocation remains valid', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native, key } = produceResponse(GRID.find((item) => item.profile === 'single-mint'));
  const copy = structuredClone(native);
  const grant = copy.public.grants.find((item) => item.grant_id === key.target_grant_ids[0]);
  const reset = copy.public.resets.find(
    (item) => item.compromised_user === grant.principal_binding,
  );
  grant.enumeration_facet = reset.defect_enumerated;
  grant.revoked_at_tick = 0;
  reset.revoked_grant_ids = computeRevokedGrantIds(copy.public.grants, copy.public.registry, reset);
  byId(copy.public.events, 'event_id').get(reset.reset_event_id).revoked_grant_ids = [
    ...reset.revoked_grant_ids,
  ];
  delete copy.hidden.revocation_lag_ticks[grant.grant_id];
  assert.ok(reset.revoked_grant_ids.includes(grant.grant_id));
  assert.ok(
    copy.public.events.some(
      (event) =>
        event.kind === 'access-token-issued' &&
        event.grant_id === grant.grant_id &&
        event.source_time > reset.reset_time,
    ),
  );
  assert.equal(validateResponseNative(copy).reason, 'token issued after reset revocation');

  const manual = produceResponse(GRID.find((item) => item.profile === 'mint-plus-session-only'));
  const manualGrant = manual.native.public.grants.find(
    (item) => item.grant_id === manual.key.session_only_grant_ids[0],
  );
  const manualReset = manual.native.public.resets.find(
    (item) => item.compromised_user === manualGrant.principal_binding,
  );
  assert.equal(manualGrant.revoked_at_tick, 0);
  assert.equal(manualReset.revoked_grant_ids.includes(manualGrant.grant_id), false);
  assert.ok(
    manual.native.public.events.some(
      (event) =>
        event.kind === 'access-token-issued' &&
        event.grant_id === manualGrant.grant_id &&
        event.source_time > manualReset.reset_time,
    ),
  );
  assert.equal(validateResponseNative(manual.native).ok, true);
});

test('native validation rejects orphan token and session events', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const orphanToken = structuredClone(native);
  const unresetUser = orphanToken.public.principals.find(
    (principal) =>
      !orphanToken.public.resets.some((reset) => reset.compromised_user === principal.user_id),
  ).user_id;
  const baseGrant = orphanToken.public.grants.find(
    (grant) => grant.principal_binding === unresetUser,
  );
  orphanToken.public.tokens = orphanToken.public.tokens.filter(
    (token) => token.grant_id !== baseGrant.grant_id,
  );
  assert.equal(validateResponseNative(orphanToken).reason, 'token or session event bijection');
  const orphanSession = structuredClone(native);
  orphanSession.public.sessions.pop();
  assert.equal(validateResponseNative(orphanSession).reason, 'token or session event bijection');
  const orphanTokenRecord = structuredClone(native);
  orphanTokenRecord.public.tokens.push({
    ...orphanTokenRecord.public.tokens[0],
    token_id: 'orphan-token-record',
    event_id: 'orphan-token-event',
  });
  assert.equal(
    validateResponseNative(orphanTokenRecord).reason,
    'token or session event bijection',
  );
  const orphanSessionRecord = structuredClone(native);
  orphanSessionRecord.public.sessions.push({
    ...orphanSessionRecord.public.sessions[0],
    session_id: 'orphan-session-record',
    event_id: 'orphan-session-event',
  });
  assert.equal(
    validateResponseNative(orphanSessionRecord).reason,
    'token or session event bijection',
  );
});

test('native validation rejects revocation events for live grants and revoked approved jobs', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const job = native.public.jobs.find((item) =>
    native.public.resets.some((reset) => reset.compromised_user === item.owner_user_id),
  );
  const liveGrant = native.public.grants.find((grant) => grant.grant_id === job.approved_grant_id);
  const eventForLiveGrant = structuredClone(native);
  appendManualRevocation(eventForLiveGrant.public, liveGrant);
  assert.equal(
    validateResponseNative(eventForLiveGrant).reason,
    'native revocation event mismatch',
  );
  const revokedJobGrant = structuredClone(native);
  revokedJobGrant.public.grants.find(
    (grant) => grant.grant_id === liveGrant.grant_id,
  ).revoked_at_tick = 0;
  appendManualRevocation(revokedJobGrant.public, liveGrant);
  assert.equal(validateResponseNative(revokedJobGrant).reason, 'approved job or runner provenance');
});

test('runner registration source time must precede signed authorization', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const copy = structuredClone(native);
  const authorization = copy.public.runner_authorizations[0];
  const runner = copy.public.runners.find((item) => item.runner_id === authorization.runner_id);
  const runnerEvent = byId(copy.public.events, 'event_id').get(runner.source_event_id);
  const authorizationEvent = byId(copy.public.events, 'event_id').get(
    authorization.source_event_id,
  );
  runnerEvent.source_time = authorizationEvent.source_time + 1;
  runnerEvent.arrival_time = Math.max(runnerEvent.arrival_time, runnerEvent.source_time);
  assert.equal(validateResponseNative(copy).reason, 'approved job or runner provenance');
});

test('two live targets require one fast and one slow hidden propagation lag', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const copy = structuredClone(native);
  for (const grantId of Object.keys(copy.hidden.revocation_lag_ticks)) {
    copy.hidden.revocation_lag_ticks[grantId] = 2;
  }
  assert.equal(validateResponseNative(copy).reason, 'hidden propagation schedule');
});

for (const kind of [
  'runner-registered',
  'delegated-grant-created',
  'approved-job-created',
  'runner-authorized',
  'compromised-user-remediated',
]) {
  test(`native validation rejects an unbacked extra ${kind} event`, async () => {
    const { GRID, produceResponse, validateResponseNative } = await modules();
    const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
    const copy = structuredClone(native);
    appendUnbackedEvent(copy.public, kind);
    assert.equal(validateResponseNative(copy).reason, 'native record event bijection');
  });
}

test('native validation rejects a duplicate manual revocation event for one grant', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const copy = structuredClone(native);
  appendUnbackedEvent(copy.public, 'delegated-grant-revoked');
  assert.equal(validateResponseNative(copy).reason, 'native revocation event mismatch');
});

test('an additional approved protected call remains a valid event-only fact', async () => {
  const { GRID, produceResponse, validateResponseNative } = await modules();
  const { native } = produceResponse(GRID.find((item) => item.profile === 'both-live'));
  const copy = structuredClone(native);
  const approvedUser = copy.public.principals.find(
    (principal) =>
      !copy.public.resets.some((reset) => reset.compromised_user === principal.user_id),
  ).user_id;
  const approvedGrantIds = new Set(
    copy.public.grants
      .filter((grant) => grant.principal_binding === approvedUser)
      .map((grant) => grant.grant_id),
  );
  const approvedTokenEventIds = new Set(
    copy.public.events
      .filter(
        (event) => event.kind === 'access-token-issued' && approvedGrantIds.has(event.grant_id),
      )
      .map((event) => event.event_id),
  );
  const call = copy.public.events.find(
    (event) =>
      event.kind === 'protected-export-call' && approvedTokenEventIds.has(event.token_event_id),
  );
  assert.ok(call);
  copy.public.events.push({
    ...call,
    event_id: 'evt_test_additional_approved_call',
    arrival_time: Math.max(...copy.public.events.map((event) => event.arrival_time)) + 1,
    arrival_index: copy.public.events.length,
  });
  assert.equal(validateResponseNative(copy).ok, true);
});
