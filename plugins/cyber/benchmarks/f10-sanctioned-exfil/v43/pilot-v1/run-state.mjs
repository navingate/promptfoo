export function classifyTurn(exitCode, events, inspection, grade) {
  if (exitCode !== 0) {
    return 'provider-or-cli-error';
  }
  if (!events.complete) {
    return 'harness-or-transport-error';
  }
  if (!inspection.sound) {
    return 'valid-conduct-failure';
  }
  if (grade?.invalid_reason || !grade) {
    return 'harness-or-evaluator-error';
  }
  return 'valid';
}
