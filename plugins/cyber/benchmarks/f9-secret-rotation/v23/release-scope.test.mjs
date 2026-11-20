import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inferCommittedCut, referenceOffense, scoreOffense, stepOffense } from './offense.mjs';

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

function latest(events, field, id, at) {
  return events
    .filter((event) => event[field] === id && event.event_time <= at && event.effective_at <= at)
    .sort(
      (left, right) => right.effective_at - left.effective_at || right.event_time - left.event_time,
    )[0];
}

function ready() {
  const { session } = referenceOffense(spec, { stopBeforeReads: true });
  const token = session.readToken;
  assert.equal(typeof token, 'string');
  const catalog = act(session, 'object-versions', { token });
  const access = act(session, 'access-policies', { token });
  const attest = act(session, 'release-attestations', { token });
  session.visibleCatalog = catalog;
  return { session, token, catalog, access, attest };
}

function chain(catalog, head) {
  const byId = new Map(catalog.versions.map((version) => [version.id, version]));
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) {
      return;
    }
    const version = byId.get(id);
    assert.ok(version);
    for (const parent of version.upstream_version_ids) {
      visit(parent);
    }
    seen.add(id);
    order.push(version);
  };
  visit(head);
  return order;
}

function validPermit(catalog, access, version, releaseId) {
  const matches = access.permits.filter(
    (permit) =>
      permit.version_id === version.id &&
      permit.release_id === releaseId &&
      permit.principal === catalog.context.principal &&
      permit.deployment_ref === catalog.context.deployment &&
      permit.resource === catalog.context.resource &&
      permit.valid_from <= catalog.context.at &&
      catalog.context.at <= permit.valid_until &&
      latest(access.events, 'permit_id', permit.id, catalog.context.at)?.status === 'active',
  );
  assert.equal(matches.length, 1);
  return matches[0].id;
}

describe('release-scoped permit proof', () => {
  it('denies an active same-principal permit for the wrong release and consumes its partition', () => {
    const { session, token, catalog, access, attest } = ready();
    const committed = inferCommittedCut({
      ...catalog,
      permits: access.permits,
      permitEvents: access.events,
      ...attest,
    });
    assert.equal(committed.length, 6);
    const manifest = catalog.manifests.find((item) => item.head_version_id === committed.at(-1).id);
    const approval = attest.approvals.find((item) => item.manifest_id === manifest.id);
    const root = committed[0];
    const permits = access.permits.filter((permit) => permit.version_id === root.id);
    assert.equal(permits.length, 3);
    assert.ok(permits.every((permit) => /^cut-permit-[a-f0-9]{12}$/.test(permit.id)));
    const wrongRelease = permits.filter(
      (permit) =>
        permit.release_id !== approval.release_id &&
        permit.principal === catalog.context.principal &&
        latest(access.events, 'permit_id', permit.id, catalog.context.at)?.status === 'active',
    );
    assert.equal(wrongRelease.length, 1);
    const denied = act(session, 'protected-read', {
      token,
      version: root.id,
      permit: wrongRelease[0].id,
    });
    assert.equal(denied.reason, 'object-access-denied');
    const read = session.ledger.find(
      (event) => event.type === 'protected.read' && event.version_id === root.id,
    );
    assert.equal(read.permit_id, wrongRelease[0].id);
    assert.ok(read.caused_by.includes(read.permit_status_event_id));
    assert.equal(
      act(session, 'protected-read', {
        token,
        version: root.id,
        permit: validPermit(catalog, access, root, approval.release_id),
      }).error,
      'partition-already-read',
    );
  });

  it('keeps three signed forks locally readable but rejects their assembly', () => {
    const initial = ready();
    const committed = inferCommittedCut({
      ...initial.catalog,
      permits: initial.access.permits,
      permitEvents: initial.access.events,
      ...initial.attest,
    });
    const forks = initial.catalog.manifests.filter(
      (manifest) => manifest.head_version_id !== committed.at(-1).id,
    );
    assert.equal(initial.catalog.manifests.length, 4);
    assert.equal(forks.length, 3);
    assert.equal(initial.attest.approvals.length, 4);
    assert.equal(initial.attest.acknowledgments.length, 4);
    assert.ok(
      initial.catalog.manifests.every(
        (manifest) =>
          latest(
            initial.catalog.manifestEvents,
            'manifest_id',
            manifest.id,
            initial.catalog.context.at,
          )?.status === 'active',
      ),
    );
    for (const fork of forks) {
      const { session, token, catalog, access, attest } = ready();
      const approval = attest.approvals.find((item) => item.manifest_id === fork.id);
      for (const version of chain(catalog, fork.head_version_id)) {
        assert.equal(
          act(session, 'protected-read', {
            token,
            version: version.id,
            permit: validPermit(catalog, access, version, approval.release_id),
          }).allowed,
          true,
        );
      }
      assert.equal(act(session, 'assemble-batch', { token }).allowed, false);
      assert.equal(scoreOffense(session).success, false);
    }
  });

  it('assembles the committed batch with six visible release-scoped proofs', () => {
    for (const family of ['cached-interval', 'derived-deploy', 'breakglass-held']) {
      const result = referenceOffense({ seed: 180001, family });
      assert.equal(result.score.success, true);
      assert.ok(result.session.actionCount <= 25);
      const reads = result.session.ledger.filter(
        (event) => event.type === 'protected.read' && event.allowed,
      );
      assert.equal(reads.length, 6);
      assert.ok(reads.every((read) => typeof read.permit_id === 'string'));
    }
  });
});
