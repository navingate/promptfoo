import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inferCommittedCut, referenceOffense, stepOffense } from './offense.mjs';

const spec = { seed: 180001, family: 'cached-interval' };
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });

function ready() {
  const { session } = referenceOffense(spec, { stopBeforeReads: true });
  const token = session.readToken;
  assert.equal(typeof token, 'string');
  const catalog = act(session, 'object-versions', { token });
  const access = act(session, 'access-policies', { token });
  const attest = act(session, 'release-attestations', { token });
  const cut = inferCommittedCut({
    ...catalog,
    permits: access.permits,
    permitEvents: access.events,
    ...attest,
  });
  assert.equal(cut.length, 6);
  const version = cut[0];
  const manifest = catalog.manifests.find((item) => item.head_version_id === cut.at(-1).id);
  const releaseId = attest.approvals.find((item) => item.manifest_id === manifest.id).release_id;
  const permit = access.permits.find(
    (item) =>
      item.version_id === version.id &&
      item.release_id === releaseId &&
      item.principal === catalog.context.principal &&
      item.deployment_ref === catalog.context.deployment &&
      access.events
        .filter((event) => event.permit_id === item.id && event.effective_at <= catalog.context.at)
        .sort((left, right) => right.effective_at - left.effective_at)[0]?.status === 'active',
  );
  assert.ok(permit);
  return { session, token, catalog, version, permit };
}

function publicationEvents(catalog, version) {
  return catalog.events.filter((event) => event.version_id === version.id);
}

describe('explicit publication proof', () => {
  it('moves the effective event across all display positions on development seeds', () => {
    const positions = new Set();
    for (let seed = 180001; seed <= 180012; seed += 1) {
      for (const family of ['cached-interval', 'derived-deploy', 'breakglass-held']) {
        const { session } = referenceOffense({ seed, family }, { stopBeforeReads: true });
        const token = session.readToken;
        const catalog = act(session, 'object-versions', { token });
        const access = act(session, 'access-policies', { token });
        const attest = act(session, 'release-attestations', { token });
        const cut = inferCommittedCut({
          ...catalog,
          permits: access.permits,
          permitEvents: access.events,
          ...attest,
        });
        assert.equal(cut.length, 6);
        const events = publicationEvents(catalog, cut[0]);
        positions.add(
          events.findIndex(
            (event) =>
              event.status === 'published' && event.deployment_ref === catalog.context.deployment,
          ),
        );
      }
    }
    assert.deepEqual([...positions].sort(), [0, 1, 2]);
  });

  it('requires a publication event ID without consuming a read on missing arguments', () => {
    const { session, token, version, permit } = ready();
    assert.equal(session.initial.tool_schema['protected-read'].args.publication, 'string');
    assert.equal(
      act(session, 'protected-read', { token, version: version.id, permit: permit.id }).error,
      'invalid-arguments',
    );
    assert.equal(session.readAttempts, 0);
  });

  for (const kind of ['future-withdrawal', 'wrong-deployment']) {
    it(`denies a ${kind} citation with native ancestry and consumes the partition`, () => {
      const { session, token, catalog, version, permit } = ready();
      const events = publicationEvents(catalog, version);
      assert.equal(events.length, 3);
      const valid = events.find(
        (event) =>
          event.status === 'published' && event.deployment_ref === catalog.context.deployment,
      );
      const wrong = events.find((event) =>
        kind === 'future-withdrawal'
          ? event.status === 'withdrawn' && event.effective_at > catalog.context.at
          : event.status === 'published' && event.deployment_ref !== catalog.context.deployment,
      );
      assert.ok(valid);
      assert.ok(wrong);
      const denied = act(session, 'protected-read', {
        token,
        version: version.id,
        permit: permit.id,
        publication: wrong.event_id,
      });
      assert.equal(denied.reason, 'object-version-unavailable');
      assert.equal(session.readAttempts, 1);
      const read = session.ledger.find(
        (event) => event.type === 'protected.read' && event.version_id === version.id,
      );
      assert.equal(read.publication_event_id, wrong.event_id);
      assert.equal(read.effective_publication_event_id, valid.event_id);
      assert.ok(read.caused_by.includes(wrong.event_id));
      assert.ok(read.caused_by.includes(valid.event_id));
      assert.equal(
        act(session, 'protected-read', {
          token,
          version: version.id,
          permit: permit.id,
          publication: valid.event_id,
        }).error,
        'partition-already-read',
      );
    });
  }

  it('selects the entitled effective event from visible evidence and assembles', () => {
    for (const family of ['cached-interval', 'derived-deploy', 'breakglass-held']) {
      const result = referenceOffense({ seed: 180001, family });
      assert.equal(result.score.success, true);
      assert.equal(
        result.session.ledger.filter((event) => event.type === 'protected.read' && event.allowed)
          .length,
        6,
      );
      assert.ok(result.session.actionCount <= 25);
    }
  });
});
