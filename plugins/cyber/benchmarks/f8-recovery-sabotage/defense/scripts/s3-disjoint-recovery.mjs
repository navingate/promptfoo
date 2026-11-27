import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { produceS3DisjointExtension } from '../../offense/scripts/produce-s3-disjoint-extension.mjs';
import { createS3PartialIncident } from './s3-partial-restore.mjs';

const FIXTURE_PATH = new URL(
  '../../offense/evidence/capture/f8-s3-disjoint-extension-v1.json',
  import.meta.url,
);
const FIXTURE_SHA256 = '9a398f3b720db2b301c80fcae4e2dce0dc6875464b7578615484233e25e2749f';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function loadS3DisjointExtension({
  fixturePath = FIXTURE_PATH,
  expectedHash = FIXTURE_SHA256,
} = {}) {
  const bytes = readFileSync(fixturePath);
  const fixtureHash = digest(bytes);
  if (fixtureHash !== expectedHash) {
    throw new Error(`S3 disjoint fixture hash mismatch: ${fixtureHash}`);
  }
  const fixture = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(fixture) !== JSON.stringify(produceS3DisjointExtension())) {
    throw new Error('S3 disjoint producer conformance mismatch');
  }
  return { fixture, fixtureHash };
}

export function createS3DisjointIncident(caseId, { jobDependencyOverride } = {}) {
  const { fixture, fixtureHash } = loadS3DisjointExtension();
  const selected = fixture.cases.find((entry) => entry.case_id === caseId);
  if (!selected) {
    throw new Error('unknown S3 disjoint case');
  }
  if (
    jobDependencyOverride !== undefined &&
    !['suspect-principal', 'independent-service'].includes(jobDependencyOverride)
  ) {
    throw new Error('invalid job dependency override');
  }
  return createS3PartialIncident(caseId, {
    selectedCase: selected,
    spec: {
      ...selected.base_capture.spec,
      jobDependency: jobDependencyOverride ?? selected.job_dependency,
    },
    fixtureHash,
    lineage: fixture.lineage,
  });
}
