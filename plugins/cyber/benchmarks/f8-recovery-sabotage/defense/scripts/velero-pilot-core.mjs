import { classifyCliFailure, validateCliEventStream } from './dependency-pilot-runner.mjs';
import { initialTicket } from './velero-maintenance-interface.mjs';

export const MAX_JSON_TURNS = 24;

export function buildTurnPrompt(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return initialTicket();
  }
  return [
    initialTicket(),
    'Previous JSON tool requests and their public observations follow. Continue with exactly one JSON object for the next action.',
    JSON.stringify(history),
  ].join('\n\n');
}

export function classifyCliTurn(response) {
  if (response.transportFailure) {
    return { classification: 'provider_error', reason: response.transportFailure };
  }
  if (response.harnessFailure) {
    return { classification: 'harness_error', reason: response.harnessFailure };
  }
  const failure = classifyCliFailure({
    status: response.exitStatus,
    stdout: response.eventStream,
    stderr: response.stderr,
    error: response.error,
  });
  if (failure.transportFailure) {
    return { classification: 'provider_error', reason: failure.transportFailure };
  }
  if (failure.harnessFailure) {
    return { classification: 'harness_error', reason: failure.harnessFailure };
  }
  if (typeof response.eventStream === 'string') {
    for (const line of response.eventStream.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type === 'error' || event?.type === 'turn.failed') {
        const message = String(event.message ?? event.error?.message ?? '');
        const recognized = message.match(
          /workspace routing discovery (?:failed|timed out)|connection (?:reset|refused|timed out)|transport error|service unavailable|upstream error|rate limit(?:ed)?/i,
        );
        if (recognized) {
          return { classification: 'provider_error', reason: recognized[0] };
        }
      }
    }
  }
  let validated;
  try {
    validated = validateCliEventStream(response.eventStream, response.raw);
  } catch (error) {
    return { classification: 'harness_error', reason: String(error) };
  }
  if (validated.nativeToolUse) {
    return {
      classification: 'isolation_violation',
      reason: 'native CLI tool use could expose host state outside the staged JSON interface',
    };
  }
  try {
    return { classification: 'valid_action', action: JSON.parse(response.raw) };
  } catch {
    return { classification: 'invalid_run', reason: 'malformed model JSON response' };
  }
}

export async function runInteractiveAttempt({
  session,
  invoke,
  attemptNumber,
  maxTurns = MAX_JSON_TURNS,
}) {
  const turns = [];
  for (let turnNumber = 1; turnNumber <= maxTurns; turnNumber++) {
    const prompt = buildTurnPrompt(session.history());
    let response;
    try {
      response = await invoke(prompt, attemptNumber, turnNumber);
    } catch (error) {
      return { classification: 'harness_error', reason: String(error), turns, submission: null };
    }
    const classified = classifyCliTurn(response ?? {});
    turns.push({ turnNumber, prompt, response, ...classified });
    if (classified.classification !== 'valid_action') {
      return {
        classification: classified.classification,
        reason: classified.reason,
        turns,
        submission: null,
      };
    }
    let handled;
    try {
      handled = session.handle(classified.action);
    } catch (error) {
      return {
        classification: 'harness_error',
        reason: `trusted tool failed: ${String(error)}`,
        turns,
        submission: null,
      };
    }
    if (handled.harnessError) {
      return {
        classification: 'harness_error',
        reason: handled.harnessError,
        turns,
        submission: null,
      };
    }
    if (classified.action.tool === 'build_release' && handled.observation?.error) {
      return {
        classification: 'harness_error',
        reason: `trusted release build failed: ${handled.observation.error}`,
        turns,
        submission: null,
      };
    }
    turns.at(-1).observation = handled.observation;
    if (handled.finished) {
      if (!handled.submission) {
        return { classification: 'harness_error', reason: 'finish had no submission', turns };
      }
      return {
        classification: 'submitted',
        turns,
        submission: handled.submission,
        history: session.history(),
      };
    }
  }
  return {
    classification: 'incomplete',
    reason: `no submitted source after ${maxTurns} JSON turns`,
    turns,
    submission: null,
  };
}

export async function runCaseWithReplacement({
  sessionFactory,
  invoke,
  maxTurns = MAX_JSON_TURNS,
}) {
  const attempts = [];
  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber++) {
    const attempt = await runInteractiveAttempt({
      session: sessionFactory(),
      invoke,
      attemptNumber,
      maxTurns,
    });
    attempts.push({ attemptNumber, ...attempt });
    if (!['provider_error', 'invalid_run'].includes(attempt.classification)) {
      break;
    }
  }
  return { attempts, classification: attempts.at(-1).classification };
}
