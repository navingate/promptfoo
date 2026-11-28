import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const modulePath = resolve(
  process.cwd(),
  'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/velero-v25-review-queue.mjs',
);
const scratch: string[] = [];
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('F8 v25 exact-source review queue', () => {
  it('sends only a hash-bound safety approval to the trusted build and records its normal log', async () => {
    const { createReviewQueue } = await import(modulePath);
    const rawDir = mkdtempSync(join(tmpdir(), 'v25-review-'));
    scratch.push(rawDir);
    const releaseBuilder = vi.fn(({ recordBuild }) => {
      recordBuild('candidate', { log: 'missing go.sum entry\n' });
      recordBuild('baseline', { log: 'unchanged build passed\n' });
      return {
        status: 1,
        logTail: 'missing go.sum entry\n',
        buildLogSha256: sha256('missing go.sum entry\n'),
      };
    });
    const queue = createReviewQueue({
      rawDir,
      sourceRepo: '/public-tag',
      benignInput: Buffer.from('benign'),
      candidateCommit: 'commit',
      freezeSha256: 'freeze',
      caseNumber: 1,
      attemptNumber: 1,
      releaseBuilder,
      approvalProvider(root: string, name: string, request: { sourceSha256: string }) {
        const requestBytes = readFileSync(join(root, 'case-1-attempt-1-review-1-request.json'));
        const approval = {
          decision: 'approve',
          requestSha256: sha256(requestBytes),
          sourceSha256: request.sourceSha256,
        };
        writeFileSync(join(root, name), JSON.stringify(approval));
        return approval;
      },
    });
    const result = queue.review({ 'hack/build-restic.sh': 'exact submitted source' }, 'preview');
    expect(result.logTail).toBe('missing go.sum entry\n');
    expect(releaseBuilder).toHaveBeenCalledTimes(1);
    expect(queue.reviewCount()).toBe(1);
    const request = JSON.parse(
      readFileSync(join(rawDir, 'case-1-attempt-1-review-1-request.json'), 'utf8'),
    );
    expect(request.kind).toBe('preview');
    expect(request.files).toEqual({ 'hack/build-restic.sh': 'exact submitted source' });
    expect(
      readFileSync(join(rawDir, 'case-1-attempt-1-review-1-candidate-build.log'), 'utf8'),
    ).toBe('missing go.sum entry\n');
  });

  it('rejects an approval for a prior source overlay before build', async () => {
    const { createReviewQueue } = await import(modulePath);
    const rawDir = mkdtempSync(join(tmpdir(), 'v25-review-stale-'));
    scratch.push(rawDir);
    const releaseBuilder = vi.fn();
    const queue = createReviewQueue({
      rawDir,
      sourceRepo: '/public-tag',
      benignInput: Buffer.from('benign'),
      candidateCommit: 'commit',
      freezeSha256: 'freeze',
      caseNumber: 1,
      attemptNumber: 1,
      releaseBuilder,
      approvalProvider(root: string, name: string) {
        const approval = {
          decision: 'approve',
          requestSha256: 'stale-request',
          sourceSha256: 'stale-source',
        };
        writeFileSync(join(root, name), JSON.stringify(approval));
        return approval;
      },
    });
    expect(() => queue.review({ 'go.mod': 'new bytes' }, 'preview')).toThrow('does not bind');
    expect(releaseBuilder).not.toHaveBeenCalled();
  });
});
