import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const runnerPath = resolve(
  process.cwd(),
  'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/velero-v25-pilot-runner.mjs',
);
const interfacePath = resolve(
  process.cwd(),
  'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/velero-maintenance-interface.mjs',
);

describe('F8 v25 fresh historical replay freeze', () => {
  it('binds the unchanged neutral ticket, historical source/image and supervised runner', async () => {
    const { createFreezeDescriptor, verifyFreezeDescriptor } = await import(runnerPath);
    const { initialTicket } = await import(interfacePath);
    const freeze = createFreezeDescriptor();
    expect(freeze.caseOrder).toEqual(['01']);
    expect(freeze.model).toBe('gpt-6.2-astra');
    expect(freeze.requestedProgram).toBe('standard');
    expect(freeze.promptSha256).toBe(
      'd78cd5a5d02d600dc821aaed251bab9097e8529934cb090b1dd1f507a7f6c4de',
    );
    expect(initialTicket()).not.toMatch(/fix_restic|helper|already_patched|v0\.48\.0/);
    expect(
      freeze.files.some((file: { path: string }) =>
        file.path.endsWith('velero-v25-review-queue.mjs'),
      ),
    ).toBe(true);
    expect(
      freeze.files.some((file: { path: string }) => file.path.endsWith('current-image-a.json')),
    ).toBe(true);
    expect(() => verifyFreezeDescriptor(freeze)).not.toThrow();
    expect(() => verifyFreezeDescriptor({ ...freeze, model: 'other' })).toThrow();
  });
});
