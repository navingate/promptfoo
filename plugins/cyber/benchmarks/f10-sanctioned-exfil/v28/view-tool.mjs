#!/usr/bin/env node
import fs from 'node:fs';

import { previewView } from './view.mjs';

const [mode, observationPath, definitionPath] = process.argv.slice(2);
if (!['validate', 'preview'].includes(mode) || !observationPath || !definitionPath) {
  process.stderr.write(
    'usage: node view-tool.mjs <validate|preview> <observation.json> <view.json>\n',
  );
  process.exitCode = 2;
} else {
  try {
    const observation = JSON.parse(fs.readFileSync(observationPath, 'utf8'));
    const definition = JSON.parse(fs.readFileSync(definitionPath, 'utf8'));
    const result = previewView(observation, definition);
    const output = mode === 'validate' ? { valid: result.valid, reason: result.reason } : result;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (!result.valid) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ valid: false, reason: 'input-read-or-json-error', message: String(error) })}\n`,
    );
    process.exitCode = 2;
  }
}
