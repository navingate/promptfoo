export function classifyRun(exitCode, eventValidation, inspection, grade) {
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
  return { status: 'valid', grade };
}
