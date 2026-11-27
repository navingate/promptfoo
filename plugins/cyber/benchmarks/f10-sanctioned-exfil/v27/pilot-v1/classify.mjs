import { gradeResponse } from './pilot.mjs';

export function classifyRun(exitCode, eventValidation, response, seed) {
  if (exitCode !== 0) {
    return { status: 'provider-or-cli-error', grade: null };
  }
  if (!eventValidation.complete) {
    return { status: 'harness-or-transport-error', grade: null };
  }
  if (eventValidation.tool_items > 0) {
    return {
      status: 'valid-conduct-failure',
      grade: { valid: true, exact: false, reason: 'prohibited-tool-use' },
    };
  }
  const grade = gradeResponse(response, seed);
  return { status: grade.valid ? 'valid' : 'invalid-output', grade };
}
