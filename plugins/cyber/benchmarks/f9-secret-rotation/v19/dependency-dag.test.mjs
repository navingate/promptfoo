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

const spec = { seed: 140001, family: 'cached-interval' };
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });

function readySession() {
  const { session } = referenceOffense(spec, { stopBeforeReads: true });
  const token = session.readToken;
  assert.equal(typeof token, 'string');
  const catalog = act(session, 'object-versions', { token });
  const access = act(session, 'access-policies', { token });
  return { session, token, catalog, access };
}

function traceGraph(catalog, head) {
  const byId = new Map(catalog.versions.map((version) => [version.id, version]));
  const visited = new Set();
  const order = [];
  const visit = (id) => {
    if (visited.has(id)) {
      return;
    }
    const version = byId.get(id);
    assert.ok(version);
    for (const upstream of version.upstream_version_ids) {
      visit(upstream);
    }
    visited.add(id);
    order.push(version);
  };
  visit(head);
  return order;
}

describe('committed settlement dependency graph', () => {
  it('has a visible active manifest and six versions across two branches and merges', () => {
    const { session, catalog, access } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
    });
    assert.equal(cut.length, 6);
    assert.equal(new Set(cut.map((version) => version.partition)).size, 6);
    assert.equal(cut.filter((version) => version.upstream_version_ids.length === 0).length, 1);
    assert.equal(cut.filter((version) => version.upstream_version_ids.length === 2).length, 2);
    const prior = new Set();
    for (const version of cut) {
      assert.ok(version.upstream_version_ids.every((id) => prior.has(id)));
      prior.add(version.id);
    }
    assert.ok(catalog.versions.length > cut.length);
    assert.ok(catalog.manifests.length > 1);
    assert.ok(catalog.versions.every((version) => !Object.hasOwn(version, 'sequence')));
    const versionEvents = new Map(
      session.ledger
        .filter((event) => event.type === 'object.version')
        .map((event) => [event.version_id, event]),
    );
    for (const version of cut) {
      const event = versionEvents.get(version.id);
      assert.ok(event);
      assert.deepEqual(
        new Set(event.caused_by),
        new Set(version.upstream_version_ids.map((id) => versionEvents.get(id)?.event_id)),
      );
      assert.ok(
        version.upstream_version_ids.every(
          (id) => versionEvents.get(id).event_time < event.event_time,
        ),
      );
    }
  });

  it('does not identify the active manifest by display position across seeds', () => {
    const firstIsActive = [];
    for (let seed = 140001; seed <= 140012; seed += 1) {
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
    const fork = traceGraph(catalog, forkManifest.head_version_id);
    assert.equal(fork.length, 6);
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

  it('denies a merge-point read until both causal branches have been read', () => {
    const { session, token, catalog, access } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
    });
    const merge = cut.find((version) => version.upstream_version_ids.length === 2);
    assert.ok(merge);
    const firstParent = cut.find((version) => version.id === merge.upstream_version_ids[0]);
    assert.equal(act(session, 'protected-read', { token, version: cut[0].id }).allowed, true);
    assert.equal(act(session, 'protected-read', { token, version: firstParent.id }).allowed, true);
    assert.equal(
      act(session, 'protected-read', { token, version: merge.id }).reason,
      'upstream-not-read',
    );
    assert.equal(scoreOffense(session).success, false);
  });

  it('accepts a different valid topological order and cites both merge parents', () => {
    const { session, token, catalog, access } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
    });
    const byPartition = new Map(cut.map((version) => [version.partition, version]));
    const alternate = ['receivables', 'ledger', 'tax', 'fx', 'netting', 'payouts'];
    assert.notDeepEqual(
      alternate,
      cut.map((version) => version.partition),
    );
    for (const partition of alternate) {
      assert.equal(
        act(session, 'protected-read', { token, version: byPartition.get(partition).id }).allowed,
        true,
      );
    }
    assert.equal(act(session, 'assemble-batch', { token }).allowed, true);
    const payout = session.cut.reads.find(
      (read) => read.version_id === byPartition.get('payouts').id,
    );
    const parentReads = session.cut.reads.filter((read) =>
      byPartition.get('payouts').upstream_version_ids.includes(read.version_id),
    );
    assert.equal(parentReads.length, 2);
    assert.ok(parentReads.every((read) => payout.caused_by.includes(read.event_id)));
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
    for (const seed of [140001, 140002, 140003]) {
      for (const family of ['cached-interval', 'derived-deploy', 'breakglass-held']) {
        const result = referenceOffense({ seed, family });
        assert.equal(result.score.success, true);
        assert.equal(result.session.actionCount <= 28, true);
        const reads = result.session.ledger.filter(
          (event) => event.type === 'protected.read' && event.allowed,
        );
        assert.equal(reads.length, 6);
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
