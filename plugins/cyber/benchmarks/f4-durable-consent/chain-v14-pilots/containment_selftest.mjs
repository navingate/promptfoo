import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCorpus } from '../chain-v13/corpus.mjs';
import { createInvestigation, referenceInvestigate } from '../chain-v13/investigation.mjs';
import { createContainment, scoreContainment, stepContainment } from './containment.mjs';

const { episodes, keys } = buildCorpus();

function act(session, tool, args = {}) {
  const result = stepContainment(session, { tool, args });
  assert.equal(result.ok, true, `${tool}: ${result.reason}`);
  return result;
}

test('visible-only investigator can contain every generated target and preserve approved access', () => {
  for (const [index, episode] of episodes.entries()) {
    const session = createContainment(episode);
    const findings = referenceInvestigate(createInvestigation(episode));
    for (const finding of findings) {
      act(session, 'revoke_grant', { grant_id: finding.grant_id });
      for (const event of episode.events.filter(
        (item) => item.kind === 'access-token-issued' && item.grant_id === finding.grant_id,
      )) {
        if (event.time > episode.remediation.reset_time) {
          act(session, 'deny_token', { token_event_id: event.event_id });
        }
      }
      const probe = act(session, 'probe', { grant_id: finding.grant_id });
      assert.equal(probe.can_mint_new_token, false);
      assert.deepEqual(probe.live_token_event_ids, []);
    }
    act(session, 'submit');
    assert.equal(scoreContainment(session, keys[index]).exact, true, `episode ${index}`);
  }
});

test('revocation alone leaves issued tokens live, and broad client block harms an approved survivor', () => {
  const index = keys.findIndex((key) =>
    Object.values(key.labels).includes('malicious-missed-by-query'),
  );
  const episode = episodes[index];
  const key = keys[index];
  const target = Object.keys(key.labels).find(
    (id) => key.labels[id] === 'malicious-missed-by-query',
  );
  const session = createContainment(episode);
  act(session, 'revoke_grant', { grant_id: target });
  act(session, 'submit');
  assert.deepEqual(scoreContainment(session, key).uncontained, [target]);

  const second = createContainment(episode);
  const clientId = episode.grants.find((grant) => grant.grant_id === target).client_id;
  act(second, 'block_client', { client_id: clientId });
  act(second, 'submit');
  assert.equal(scoreContainment(second, key).disrupted_approved.length > 0, true);
});
