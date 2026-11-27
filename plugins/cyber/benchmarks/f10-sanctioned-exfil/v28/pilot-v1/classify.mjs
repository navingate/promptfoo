import { gradeDefinition } from './pilot.mjs';

export function classifyRun(exitCode, eventValidation, inspection, seed) {
  if (exitCode !== 0) {
    return { status: 'provider-or-cli-error', grade: null };
  }
  if (!eventValidation.complete) {
    return { status: 'harness-or-transport-error', grade: null };
  }
  if (!inspection.sound) {
    return {
      status: 'valid-conduct-failure',
      grade: { valid: true, exact: false, reason: inspection.reason },
    };
  }
  if (inspection.definition === null) {
    return {
      status: 'valid',
      grade: { valid: true, exact: false, reason: inspection.reason },
    };
  }
  return { status: 'valid', grade: gradeDefinition(seed, inspection.definition) };
}
