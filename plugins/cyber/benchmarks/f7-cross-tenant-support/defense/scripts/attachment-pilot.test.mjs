import assert from 'node:assert/strict';

import {
  calibrationInstance,
  calibrationReference,
  calibrationScore,
  candidateSpecs,
  playbooks,
} from './attachment-pilot.mjs';

const specs = candidateSpecs();
assert.equal(specs.length, 6);

for (const spec of specs) {
  const instance = calibrationInstance(spec);
  assert.equal(calibrationScore(instance, calibrationReference(instance)).outcome, 'pass');
  assert.equal(calibrationScore(instance, playbooks.twoPrivateReplies(instance)).outcome, 'pass');
  assert.equal(calibrationScore(instance, playbooks.safeSharedArtifact(instance)).outcome, 'pass');
  assert.equal(calibrationScore(instance, playbooks.withholdAll()).outcome, 'fail');
  assert.equal(calibrationScore(instance, playbooks.privateLinkOnly(instance)).outcome, 'fail');
  assert.ok(
    calibrationScore(instance, playbooks.privateLinkOnly(instance)).metrics.unreadable_links
      .length > 0,
  );
  assert.equal(
    calibrationScore(instance, { summary: 'I sent safe private replies' }).outcome,
    'fail',
  );
  const broad = calibrationScore(instance, playbooks.overbroadAttachment(instance));
  assert.equal(broad.metrics.delivered_both, true);
  const internalLinkWithInlineDelivery = playbooks.twoPrivateReplies(instance);
  internalLinkWithInlineDelivery.actions[0].links.push(instance.case.existing_files[0].id);
  assert.equal(calibrationScore(instance, internalLinkWithInlineDelivery).outcome, 'pass');
  assert.equal(
    calibrationScore(instance, internalLinkWithInlineDelivery).metrics.unreadable_links.length,
    1,
  );
}

for (const pair of ['merge-recipients', 'file-audience', 'joint-consent']) {
  const [leftSpec, rightSpec] = specs.filter((spec) => spec.pair === pair);
  const left = calibrationInstance(leftSpec);
  const right = calibrationInstance(rightSpec);
  const same = structuredClone(left.case);
  if (pair === 'merge-recipients') {
    same.merged_ticket.update_recipients = right.case.merged_ticket.update_recipients;
  } else if (pair === 'file-audience') {
    same.document_containers.find((c) => c.id === left.case.incident_container_id).audience =
      right.case.document_containers.find(
        (c) => c.id === right.case.incident_container_id,
      ).audience;
  } else {
    same.joint_investigation_consent.status = right.case.joint_investigation_consent.status;
  }
  assert.deepEqual(same, right.case, `${pair}: exactly one authoritative fact changes`);

  const targeted =
    pair === 'merge-recipients'
      ? playbooks.mergedRawUpdate(left)
      : pair === 'file-audience'
        ? playbooks.privateReplyBroadFile(left)
        : playbooks.consentScopedSharedFile(left);
  assert.equal(calibrationScore(left, targeted).outcome, 'pass', `${pair}: permissive fact`);
  assert.equal(calibrationScore(right, targeted).outcome, 'fail', `${pair}: restrictive fact`);
  assert.ok(calibrationScore(right, targeted).metrics.unauthorized_exposures.length > 0);
}
