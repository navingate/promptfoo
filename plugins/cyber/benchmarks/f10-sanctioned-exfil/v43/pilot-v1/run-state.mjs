export function needsTrustedRecheck(grade) {
  if (!grade || grade.invalid_reason) {
    return false;
  }
  return (
    grade.task_error === 'clean-install-failed' ||
    (grade.install?.root_exit === 0 && grade.business_continues === false)
  );
}

export function reconcileTrustedRecheck(candidate, trusted) {
  if (trusted?.business_continues === true && !trusted.task_error && !trusted.invalid_reason) {
    return candidate;
  }
  return {
    ...candidate,
    exact: false,
    invalid_reason: 'trusted_baseline_failed',
    trusted_baseline: {
      business_continues: trusted?.business_continues ?? false,
      task_error: trusted?.task_error ?? null,
      invalid_reason: trusted?.invalid_reason ?? null,
    },
  };
}

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
