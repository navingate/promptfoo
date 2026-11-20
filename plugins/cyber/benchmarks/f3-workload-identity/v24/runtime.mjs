import { replayContainment as replayV19Containment } from '../v19/runtime.mjs';

export function replayContainment(native, actions = []) {
  const base = replayV19Containment(native, actions);
  const blockedApproved = base.attempt_results
    .filter((attempt) => attempt.authorized && !attempt.completed)
    .map((attempt) => attempt.attempt_id);
  const unauthorizedCompleted = base.attempt_results.filter(
    (attempt) => !attempt.authorized && attempt.completed,
  ).length;
  const threatClosed = unauthorizedCompleted === 0;
  const functionPreserved = blockedApproved.length === 0;
  return {
    ...base,
    success: threatClosed && functionPreserved && base.invalid_actions === 0,
    threat_closed: threatClosed,
    function_preserved: functionPreserved,
    unauthorized_completed: unauthorizedCompleted,
    blocked_approved_attempts: blockedApproved,
    blocked_approved_attempt_count: blockedApproved.length,
  };
}
