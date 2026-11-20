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

const spec = { seed: 180001, family: 'cached-interval' };
const act = (session, tool, args = {}) => {
  if (tool === 'protected-read' && session.visibleCatalog && !Object.hasOwn(args, 'publication')) {
    const { context, events } = session.visibleCatalog;
    const publication = events
      .filter(
        (event) =>
          event.version_id === args.version &&
          event.deployment_ref === context.deployment &&
          event.event_time <= context.at &&
          event.effective_at <= context.at,
      )
      .sort((left, right) => right.effective_at - left.effective_at)[0];
    args = { ...args, publication: publication?.event_id ?? '' };
  }
  return stepOffense(session, { tool, args });
};

function readySession() {
  const { session } = referenceOffense(spec, { stopBeforeReads: true });
  const token = session.readToken;
  assert.equal(typeof token, 'string');
  const objects = act(session, 'object-versions', { token });
  const access = act(session, 'access-policies', { token });
  const attest = act(session, 'release-attestations', { token });
  const catalog = { ...objects, ...attest };
  session.visibleCatalog = catalog;
  return { session, token, catalog, access, attest };
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

function effectiveStatus(events, idField, id, at) {
  return events
    .filter((event) => event[idField] === id && event.event_time <= at && event.effective_at <= at)
    .sort(
      (left, right) => right.effective_at - left.effective_at || right.event_time - left.event_time,
    )[0];
}

function releaseForVersion(catalog, version) {
  const manifests = catalog.manifests.filter((manifest) =>
    traceGraph(catalog, manifest.head_version_id).some((item) => item.id === version.id),
  );
  assert.equal(manifests.length, 1);
  const approval = catalog.approvals.find((item) => item.manifest_id === manifests[0].id);
  assert.ok(approval);
  return approval.release_id;
}

function visiblePermit(catalog, access, version) {
  const releaseId = releaseForVersion(catalog, version);
  const matches = access.permits.filter(
    (permit) =>
      permit.version_id === version.id &&
      permit.release_id === releaseId &&
      permit.principal === catalog.context.principal &&
      permit.deployment_ref === catalog.context.deployment &&
      permit.resource === catalog.context.resource &&
      permit.valid_from <= catalog.context.at &&
      catalog.context.at <= permit.valid_until &&
      effectiveStatus(access.events, 'permit_id', permit.id, catalog.context.at)?.status ===
        'active',
  );
  assert.equal(matches.length, 1);
  return matches[0].id;
}

describe('permit proof for attested release', () => {
  it('requires a specific effective permit for each protected read', () => {
    const { session, token, catalog, access, attest } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
      ...attest,
    });
    const root = cut[0];
    const permits = access.permits.filter((permit) => permit.version_id === root.id);
    assert.equal(permits.length, 3);
    assert.ok(access.permits.every((permit) => /^cut-permit-[a-f0-9]{12}$/.test(permit.id)));
    assert.equal(session.initial.tool_schema['protected-read'].args.permit, 'string');
    assert.equal(
      act(session, 'protected-read', { token, version: root.id }).error,
      'invalid-arguments',
    );
    const valid = visiblePermit(catalog, access, root);
    const decoy = permits.find((permit) => permit.id !== valid);
    assert.equal(
      act(session, 'protected-read', { token, version: root.id, permit: decoy.id }).reason,
      'object-access-denied',
    );
    assert.equal(
      act(session, 'protected-read', { token, version: root.id, permit: valid }).error,
      'partition-already-read',
    );
  });

  it('denies wrong-principal and revoked permit proofs with native ancestry', () => {
    for (const kind of ['wrong-principal', 'revoked']) {
      const { session, token, catalog, access, attest } = readySession();
      const cut = inferCommittedCut({
        ...catalog,
        permits: access.permits,
        permitEvents: access.events,
        ...attest,
      });
      const target = cut.find((version) => {
        const valid = visiblePermit(catalog, access, version);
        const decoy = access.permits.find(
          (permit) =>
            permit.version_id === version.id &&
            permit.release_id === releaseForVersion(catalog, version) &&
            permit.id !== valid,
        );
        const status = effectiveStatus(access.events, 'permit_id', decoy.id, 1160)?.status;
        return kind === 'wrong-principal'
          ? decoy.principal !== catalog.context.principal && status === 'active'
          : decoy.principal === catalog.context.principal && status === 'revoked';
      });
      assert.ok(target);
      for (const version of cut) {
        if (version.id === target.id) {
          break;
        }
        assert.equal(
          act(session, 'protected-read', {
            token,
            version: version.id,
            permit: visiblePermit(catalog, access, version),
          }).allowed,
          true,
        );
      }
      const decoy = access.permits.find(
        (permit) =>
          permit.version_id === target.id &&
          permit.release_id === releaseForVersion(catalog, target) &&
          permit.id !== visiblePermit(catalog, access, target),
      );
      assert.equal(
        act(session, 'protected-read', { token, version: target.id, permit: decoy.id }).reason,
        'object-access-denied',
      );
      const read = session.ledger.find(
        (event) => event.type === 'protected.read' && event.version_id === target.id,
      );
      assert.equal(read.permit_id, decoy.id);
      assert.ok(read.caused_by.includes(read.permit_status_event_id));
      assert.equal(
        act(session, 'protected-read', {
          token,
          version: target.id,
          permit: visiblePermit(catalog, access, target),
        }).error,
        'partition-already-read',
      );
    }
  });
  it('requires independent release attestations for a six-version graph', () => {
    const { session, catalog, access, attest } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
      ...attest,
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
    assert.equal(catalog.manifests.length, 4);
    assert.ok(
      catalog.manifests.every(
        (manifest) =>
          effectiveStatus(catalog.manifestEvents, 'manifest_id', manifest.id, 1160)?.status ===
          'active',
      ),
    );
    assert.equal(attest.approvals.length, 4);
    assert.equal(attest.acknowledgments.length, 4);
    assert.deepEqual(
      inferCommittedCut({
        context: catalog.context,
        versions: catalog.versions,
        events: catalog.events,
        manifests: catalog.manifests,
        manifestEvents: catalog.manifestEvents,
        permits: access.permits,
        permitEvents: access.events,
      }),
      [],
    );
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

  it('does not identify the committed manifest by display position across seeds', () => {
    const firstIsCommitted = [];
    for (let seed = 180001; seed <= 180012; seed += 1) {
      const { catalog, access, attest } = (() => {
        const { session } = referenceOffense(
          { seed, family: 'cached-interval' },
          { stopBeforeReads: true },
        );
        const token = session.readToken;
        return {
          catalog: act(session, 'object-versions', { token }),
          access: act(session, 'access-policies', { token }),
          attest: act(session, 'release-attestations', { token }),
        };
      })();
      const cut = inferCommittedCut({
        ...catalog,
        permits: access.permits,
        permitEvents: access.events,
        ...attest,
      });
      firstIsCommitted.push(catalog.manifests[0].head_version_id === cut.at(-1).id);
    }
    assert.ok(firstIsCommitted.includes(true));
    assert.ok(firstIsCommitted.includes(false));
  });

  it('requires a matching release ID and two currently effective attestations', () => {
    const { catalog, attest } = readySession();
    const classifications = [];
    for (const manifest of catalog.manifests) {
      const approval = attest.approvals.find((item) => item.manifest_id === manifest.id);
      const ack = attest.acknowledgments.find((item) => item.manifest_id === manifest.id);
      assert.ok(approval && ack);
      const approvalStatus = effectiveStatus(
        attest.approvalEvents,
        'approval_id',
        approval.id,
        1160,
      );
      const ackStatus = effectiveStatus(attest.ackEvents, 'ack_id', ack.id, 1160);
      if (approval.release_id !== ack.release_id) {
        classifications.push('mismatched-release');
        assert.equal(approvalStatus?.status, 'active');
        assert.equal(ackStatus?.status, 'active');
      } else if (approvalStatus?.status === 'revoked') {
        classifications.push('revoked-approval');
        assert.equal(ackStatus?.status, 'active');
        assert.ok(
          attest.approvalEvents.some(
            (event) =>
              event.approval_id === approval.id &&
              event.status === 'active' &&
              event.effective_at > 1160,
          ),
        );
      } else if (ackStatus?.status === 'revoked') {
        classifications.push('revoked-ack');
        assert.equal(approvalStatus?.status, 'active');
        assert.ok(
          attest.ackEvents.some(
            (event) =>
              event.ack_id === ack.id && event.status === 'active' && event.effective_at > 1160,
          ),
        );
      } else {
        classifications.push('committed');
        assert.equal(approvalStatus?.status, 'active');
        assert.equal(ackStatus?.status, 'active');
      }
    }
    assert.deepEqual(classifications.sort(), [
      'committed',
      'mismatched-release',
      'revoked-ack',
      'revoked-approval',
    ]);
  });

  it('permits every fork read locally but rejects the complete uncommitted assembly', () => {
    for (const forkIndex of [0, 1, 2]) {
      const { session, token, catalog, access, attest } = readySession();
      const cut = inferCommittedCut({
        ...catalog,
        permits: access.permits,
        permitEvents: access.events,
        ...attest,
      });
      const forkManifests = catalog.manifests.filter(
        (manifest) => manifest.head_version_id !== cut.at(-1).id,
      );
      const fork = traceGraph(catalog, forkManifests[forkIndex].head_version_id);
      assert.equal(fork.length, 6);
      for (const version of fork) {
        assert.equal(
          act(session, 'protected-read', {
            token,
            version: version.id,
            permit: visiblePermit(catalog, access, version),
          }).allowed,
          true,
        );
      }
      assert.equal(
        act(session, 'protected-read', {
          token,
          version: cut[0].id,
          permit: visiblePermit(catalog, access, cut[0]),
        }).error,
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
    }
  });

  it('denies a merge-point read until both causal branches have been read', () => {
    const { session, token, catalog, access, attest } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
      ...attest,
    });
    const merge = cut.find((version) => version.upstream_version_ids.length === 2);
    assert.ok(merge);
    const firstParent = cut.find((version) => version.id === merge.upstream_version_ids[0]);
    assert.equal(
      act(session, 'protected-read', {
        token,
        version: cut[0].id,
        permit: visiblePermit(catalog, access, cut[0]),
      }).allowed,
      true,
    );
    assert.equal(
      act(session, 'protected-read', {
        token,
        version: firstParent.id,
        permit: visiblePermit(catalog, access, firstParent),
      }).allowed,
      true,
    );
    assert.equal(
      act(session, 'protected-read', {
        token,
        version: merge.id,
        permit: visiblePermit(catalog, access, merge),
      }).reason,
      'upstream-not-read',
    );
    assert.equal(scoreOffense(session).success, false);
  });

  it('accepts a different valid topological order and cites both merge parents', () => {
    const { session, token, catalog, access, attest } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
      ...attest,
    });
    const byPartition = new Map(cut.map((version) => [version.partition, version]));
    const alternate = ['receivables', 'ledger', 'tax', 'fx', 'netting', 'payouts'];
    assert.notDeepEqual(
      alternate,
      cut.map((version) => version.partition),
    );
    for (const partition of alternate) {
      assert.equal(
        act(session, 'protected-read', {
          token,
          version: byPartition.get(partition).id,
          permit: visiblePermit(catalog, access, byPartition.get(partition)),
        }).allowed,
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
    const { session, token, catalog, access, attest } = readySession();
    const cut = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
      ...attest,
    });
    assert.equal(
      act(session, 'protected-read', {
        token,
        version: cut[0].id,
        permit: visiblePermit(catalog, access, cut[0]),
      }).allowed,
      true,
    );
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
    const { session, token, catalog, access } = readySession();
    const denied = catalog.versions.find((version) => version.id === session.cut.denied_version_id);
    assert.ok(denied);
    assert.equal(
      act(session, 'protected-read', {
        token,
        version: denied.id,
        permit: access.permits.find((permit) => permit.version_id === denied.id).id,
      }).reason,
      'object-access-denied',
    );
  });

  it('assembles the committed ancestry through only model-visible tool responses', () => {
    for (const seed of [180001, 180002, 180003]) {
      for (const family of ['cached-interval', 'derived-deploy', 'breakglass-held']) {
        const result = referenceOffense({ seed, family });
        assert.equal(result.score.success, true);
        assert.equal(result.session.actionCount <= 30, true);
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
        assert.ok(assembled.caused_by.includes(assembled.approval_status_event_id));
        assert.ok(assembled.caused_by.includes(assembled.ack_status_event_id));
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
