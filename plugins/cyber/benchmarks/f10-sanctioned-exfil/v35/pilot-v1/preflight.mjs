#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { gradeSubmittedWorker } from './evaluate.mjs';
import { buildPilotCase } from './pilot.mjs';
import {
  createRunDirectories,
  permissionConfigArgs,
  probePublicValidator,
  probeReadBoundary,
  stageModelDirectory,
} from './workdir.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const repositoryRoot = path.resolve(import.meta.dirname, '../../../../../../../..');
const sourceDirectory = import.meta.dirname;
const item = buildPilotCase(Number(process.argv[2] ?? 0));
const { modelDirectory, rawDirectory } = createRunDirectories();
try {
  const staged = stageModelDirectory(modelDirectory, sourceDirectory, item.context);
  const rawSentinel = path.join(rawDirectory, 'private-sentinel.txt');
  fs.writeFileSync(rawSentinel, 'private');
  const deniedFiles = [
    path.resolve(import.meta.dirname, '../../v34/evidence/fixture.json'),
    path.resolve(import.meta.dirname, '../../v34/scorer.mjs'),
    path.resolve(
      import.meta.dirname,
      '../../v33/pilot-v1/evidence/raw/case-0-attempt-1/summary.json',
    ),
    rawSentinel,
    '/Users/navnn/.codex/config.toml',
    '/Users/navnn/.codex/sessions/2026/02/07/rollout-2026-02-07T06-13-17-019c35df-fd91-7e02-8d37-86533f585868.jsonl.zst',
  ].map((file) => ({ path: file, expectedSha256: sha256(fs.readFileSync(file)) }));
  const modelBoundary = probeReadBoundary({ modelDirectory, repositoryRoot, deniedFiles });
  const publicValidator = probePublicValidator(modelDirectory, repositoryRoot);
  const broken = gradeSubmittedWorker(path.join(modelDirectory, 'release-worker.mjs'), item.seed);
  process.stdout.write(
    `${JSON.stringify(
      {
        case_index: item.index,
        staged,
        permission_config_sha256: sha256(
          JSON.stringify(permissionConfigArgs(modelDirectory, repositoryRoot)),
        ),
        model_boundary: modelBoundary,
        public_validator: publicValidator,
        restricted_host_execution: {
          broken_distinct_exact: broken.futures.distinct.score.exact,
          broken_overlap_exact: broken.futures.overlap.score.exact,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  fs.rmSync(modelDirectory, { recursive: true, force: true });
  fs.rmSync(rawDirectory, { recursive: true, force: true });
}
