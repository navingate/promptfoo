import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_TURNS } from './config.mjs';
import { readFrozenCorpus } from './corpus.mjs';
import {
  createInvestigation,
  referenceInvestigate,
  scoreInvestigation,
  stepInvestigation,
} from './investigation.mjs';

const { episodes, keys } = readFrozenCorpus();

test('the visible-only investigator solves every shared-reset incident within budget', () => {
  for (let index = 0; index < episodes.length; index += 1) {
    const session = createInvestigation(episodes[index]);
    const findings = referenceInvestigate(session);
    assert.ok(session.actions + 1 <= session.initial.budget.tool_actions);
    assert.equal(stepInvestigation(session, { tool: 'submit', args: { findings } }).ok, true);
    const score = scoreInvestigation(session, keys[index]);
    assert.equal(score.exact, true, `${index}: ${JSON.stringify(score)}`);
    assert.equal(score.evidence_sufficient, score.tp);
  }
});

test('tools expose bounded source queries without labels', () => {
  const session = createInvestigation(episodes[0]);
  assert.doesNotMatch(JSON.stringify(session.initial), /malicious|label|target_count|family|seed/u);
  assert.equal(session.initial.budget.model_turns, MAX_TURNS);
  const page = stepInvestigation(session, { tool: 'list_grants', args: { cursor: 0 } });
  assert.equal(page.ok, true);
  assert.ok(page.grants.length <= 4);
  const first = page.grants[0];
  const registry = stepInvestigation(session, {
    tool: 'get_registry',
    args: { client_id: first.client_id },
  });
  const remediation = stepInvestigation(session, { tool: 'get_remediation', args: {} });
  const events = stepInvestigation(session, {
    tool: 'get_events',
    args: { client_id: first.client_id },
  });
  assert.equal(registry.ok, true);
  assert.equal(remediation.ok, true);
  assert.equal(events.ok, true);
  for (const call of events.events.filter((event) => event.kind === 'protected-export-call')) {
    assert.equal(Object.hasOwn(call, 'grant_id'), false);
    assert.equal(Object.hasOwn(call, 'credential_lineage'), false);
  }
  for (const response of [page, registry, remediation, events]) {
    assert.doesNotMatch(JSON.stringify(response), /malicious|_label|_target|source_seed/u);
  }
  assert.equal(
    stepInvestigation(session, { tool: 'get_events', args: { client_id: 'unknown' } }).ok,
    false,
  );
});

test('zero findings pass a true negative and survival-only fires on approved grants', () => {
  const zero = keys.findIndex((key) =>
    Object.values(key.labels).every((label) => label !== 'malicious-missed-by-query'),
  );
  const session = createInvestigation(episodes[zero]);
  stepInvestigation(session, { tool: 'submit', args: { findings: [] } });
  assert.equal(scoreInvestigation(session, keys[zero]).exact, true);
  const positive = keys.findIndex((key) =>
    Object.values(key.labels).includes('malicious-missed-by-query'),
  );
  const other = createInvestigation(episodes[positive]);
  stepInvestigation(other, {
    tool: 'submit',
    args: {
      findings: episodes[positive].grants
        .filter((grant) =>
          episodes[positive].events.some(
            (event) =>
              event.kind === 'protected-export-call' && event.client_id === grant.client_id,
          ),
        )
        .map((grant) => ({ grant_id: grant.grant_id })),
    },
  });
  const scored = scoreInvestigation(other, keys[positive]);
  assert.equal(scored.exact, false);
  assert.ok(scored.fp > 0);
});

test('the visible reference follows cause, reset, revocation and approval', () => {
  const index = keys.findIndex((key) =>
    Object.values(key.labels).includes('malicious-missed-by-query'),
  );
  const positiveId = Object.entries(keys[index].labels).find(
    ([, label]) => label === 'malicious-missed-by-query',
  )[0];
  const callFor = (episode) => {
    const token = episode.events.find(
      (event) => event.kind === 'access-token-issued' && event.grant_id === positiveId,
    );
    return episode.events.find(
      (event) =>
        event.kind === 'protected-export-call' && event.caused_by_event_id === token.event_id,
    );
  };
  for (const mutate of [
    (episode) => {
      callFor(episode).caused_by_event_id = 'event_broken';
    },
    (episode) => {
      episode.remediation.revoked_grant_ids.push(positiveId);
    },
    (episode) => {
      callFor(episode).time = episode.remediation.reset_time - 1;
    },
    (episode) => {
      const grant = episode.grants.find((item) => item.grant_id === positiveId);
      episode.registry.push({
        policy_entry_id: 'policy_control',
        client_or_app_selector: grant.client_id,
        tenant_selector: grant.tenant,
        principal_selector: grant.principal_binding,
        scope_selector: grant.scopes,
        approval_route_selector: grant.approval_route,
        valid_from: 0,
        valid_until: null,
        revoked_at: null,
      });
    },
  ]) {
    const changed = structuredClone(episodes[index]);
    mutate(changed);
    const findings = referenceInvestigate(createInvestigation(changed));
    assert.equal(
      findings.some((item) => item.grant_id === positiveId),
      false,
    );
  }
});

test('invalid findings are separated from model failure', () => {
  const session = createInvestigation(episodes[0]);
  const response = stepInvestigation(session, {
    tool: 'submit',
    args: { findings: [{ grant_id: 'unknown' }] },
  });
  assert.equal(response.ok, false);
  assert.equal(scoreInvestigation(session, keys[0]).classification, 'invalid_output');
});

test('cross-grant citations cannot satisfy the evidence diagnostic', () => {
  const index = keys.findIndex((key) =>
    Object.values(key.labels).includes('malicious-missed-by-query'),
  );
  const episode = episodes[index];
  const session = createInvestigation(episode);
  const findings = referenceInvestigate(session);
  const positive = findings[0];
  const other = episode.grants.find(
    (grant) =>
      grant.grant_id !== positive.grant_id &&
      episode.events.some(
        (tokenEvent) =>
          tokenEvent.kind === 'access-token-issued' &&
          tokenEvent.grant_id === grant.grant_id &&
          episode.events.some(
            (callEvent) =>
              callEvent.kind === 'protected-export-call' &&
              callEvent.caused_by_event_id === tokenEvent.event_id,
          ),
      ),
  );
  const created = episode.events.find(
    (event) => event.kind === 'delegated-grant-created' && event.grant_id === other.grant_id,
  );
  const token = episode.events.find(
    (event) => event.kind === 'access-token-issued' && event.grant_id === other.grant_id,
  );
  const call = episode.events.find(
    (event) =>
      event.kind === 'protected-export-call' && event.caused_by_event_id === token.event_id,
  );
  const substituted = findings.map((item) =>
    item.grant_id === positive.grant_id
      ? {
          grant_id: item.grant_id,
          evidence_event_ids: [
            created.event_id,
            episode.remediation.reset_event_id,
            token.event_id,
            call.event_id,
          ],
        }
      : item,
  );
  stepInvestigation(session, { tool: 'submit', args: { findings: substituted } });
  const score = scoreInvestigation(session, keys[index]);
  assert.equal(score.exact, true);
  assert.ok(score.evidence_sufficient < score.tp);
});
