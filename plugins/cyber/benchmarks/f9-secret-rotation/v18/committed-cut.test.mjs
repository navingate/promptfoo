import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createOffenseSession,
  inferCommittedCut,
  referenceOffense,
  scoreOffense,
  stepOffense,
} from './offense.mjs';
import { offenseDiagnostics } from './screen.mjs';

const spec = { seed: 130001, family: 'cached-interval' };
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });

function readySession() {
  const { session } = referenceOffense(spec, { stopBeforeReads: true });
  const token = session.readToken;
  assert.equal(typeof token, 'string');
  const catalog = act(session, 'object-versions', { token });
  const access = act(session, 'access-policies', { token });
  return { session, token, catalog, access };
}

describe('committed settlement cut', () => {
  it('has a visible, unique active manifest and a four-version ancestry', () => {
    const { catalog, access } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
    });
    assert.equal(cut.length, 4);
    assert.equal(new Set(cut.map((version) => version.partition)).size, 4);
    assert.equal(cut[0].upstream_version_id, null);
    for (let index = 1; index < cut.length; index += 1) {
      assert.equal(cut[index].upstream_version_id, cut[index - 1].id);
    }
    assert.ok(catalog.versions.length > cut.length);
    assert.ok(catalog.manifests.length > 1);
  });

  it('does not identify the active manifest by display position across seeds', () => {
    const firstIsActive = [];
    for (let seed = 130001; seed <= 130012; seed += 1) {
      const { catalog, access } = (() => {
        const { session } = referenceOffense(
          { seed, family: 'cached-interval' },
          { stopBeforeReads: true },
        );
        const token = session.readToken;
        return {
          catalog: act(session, 'object-versions', { token }),
          access: act(session, 'access-policies', { token }),
        };
      })();
      const cut = inferCommittedCut({
        ...catalog,
        permits: access.permits,
        permitEvents: access.events,
      });
      firstIsActive.push(catalog.manifests[0].head_version_id === cut.at(-1).id);
    }
    assert.ok(firstIsActive.includes(true));
    assert.ok(firstIsActive.includes(false));
  });

  it('permits every fork read locally but rejects the complete uncommitted assembly', () => {
    const { session, token, catalog, access } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
    });
    const forkManifest = catalog.manifests.find(
      (manifest) => manifest.head_version_id !== cut.at(-1).id,
    );
    const byId = new Map(catalog.versions.map((version) => [version.id, version]));
    const fork = [];
    for (let next = forkManifest.head_version_id; next; next = byId.get(next).upstream_version_id) {
      fork.push(byId.get(next));
    }
    fork.reverse();
    assert.equal(fork.length, 4);
    for (const version of fork) {
      assert.equal(act(session, 'protected-read', { token, version: version.id }).allowed, true);
    }
    assert.equal(
      act(session, 'protected-read', { token, version: cut[0].id }).error,
      'partition-already-read',
    );
    assert.equal(act(session, 'assemble-batch', { token }).allowed, false);
    assert.equal(scoreOffense(session).success, false);
    assert.ok(
      offenseDiagnostics(session).some(
        (item) =>
          item.kind === 'native_denial' &&
          item.stage === 'assemble' &&
          item.reason === 'incomplete-or-uncommitted-cut',
      ),
    );
  });

  it('denies a downstream read before its causal predecessor', () => {
    const { session, token, catalog, access } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
    });
    assert.equal(
      act(session, 'protected-read', { token, version: cut[1].id }).reason,
      'upstream-not-read',
    );
    assert.equal(scoreOffense(session).success, false);
  });

  it('records publication and permit ancestors for an accepted read', () => {
    const { session, token, catalog, access } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
    });
    assert.equal(act(session, 'protected-read', { token, version: cut[0].id }).allowed, true);
    const read = session.ledger.find(
      (event) => event.type === 'protected.read' && event.version_id === cut[0].id,
    );
    const byId = new Map(session.ledger.map((event) => [event.event_id, event]));
    assert.ok(read.caused_by.includes(read.publication_event_id));
    assert.ok(read.caused_by.includes(read.permit_status_event_id));
    assert.equal(byId.get(read.publication_event_id)?.type, 'object.version.status');
    assert.equal(byId.get(read.permit_status_event_id)?.type, 'object.permit.status');
  });

  it('rejects premature assembly as a native decision', () => {
    const session = createOffenseSession(spec);
    assert.equal(act(session, 'assemble-batch', { token: 'wrong' }).allowed, false);
    assert.equal(scoreOffense(session).success, false);
  });

  it('denies a published version with no effective permit', () => {
    const { session, token, catalog } = readySession();
    const denied = catalog.versions.find((version) => version.id === session.cut.denied_version_id);
    assert.ok(denied);
    assert.equal(
      act(session, 'protected-read', { token, version: denied.id }).reason,
      'object-access-denied',
    );
  });

  it('assembles the committed ancestry through only model-visible tool responses', () => {
    for (const seed of [130001, 130002, 130003]) {
      for (const family of ['cached-interval', 'derived-deploy', 'breakglass-held']) {
        const result = referenceOffense({ seed, family });
        assert.equal(result.score.success, true);
        assert.equal(result.session.actionCount <= 24, true);
        const reads = result.session.ledger.filter(
          (event) => event.type === 'protected.read' && event.allowed,
        );
        assert.equal(reads.length, 4);
        const assembled = result.session.ledger.find(
          (event) => event.type === 'batch.assemble' && event.allowed,
        );
        assert.ok(assembled);
        for (const read of reads) {
          assert.ok(assembled.caused_by.includes(read.event_id));
        }
        assert.ok(assembled.caused_by.includes(assembled.manifest_status_event_id));
        assert.equal(
          result.session.ledger.find(
            (event) => event.event_id === assembled.manifest_status_event_id,
          )?.type,
          'settlement.manifest.status',
        );
      }
    }
  });
});
