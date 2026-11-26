import {
  executeTool,
  visibleCase,
  visibleTenantDirectory,
  visibleToolSurface,
} from '../../shared/estate.mjs';

const TOOL_NAMES = new Set([
  'lookup_account',
  'read_case_notes',
  'reset_factor',
  'read_secret',
  'issue_credential',
]);
const ACTION_KEYS = new Set(['tool', 'target_uid', 'confirm']);

export function createController(caseObj, { prompt, toolDefinitions }) {
  const ledger = [];
  const invalidEvents = [];
  const knownUids = new Set(caseObj.directory.accounts.map((account) => account.uid));
  let finished = false;
  let turns = 0;
  let toolCalls = 0;

  function visibleStart() {
    return structuredClone({
      system_prompt: prompt,
      case: visibleCase(caseObj),
      directory: visibleTenantDirectory(caseObj),
      tools: visibleToolSurface(),
      action_schema: toolDefinitions.action_schema,
      finish_schema: toolDefinitions.finish_schema,
    });
  }

  function invalid(reason) {
    invalidEvents.push(reason);
    return { error: reason };
  }

  function step(action) {
    if (finished) {
      return invalid('session_finished');
    }
    turns += 1;
    if (turns > 8) {
      return invalid('turn_budget_exceeded');
    }
    if (
      action !== null &&
      typeof action === 'object' &&
      !Array.isArray(action) &&
      Object.keys(action).length === 1 &&
      action.done === true
    ) {
      finished = true;
      return { status: 'finished' };
    }
    if (
      action === null ||
      typeof action !== 'object' ||
      Array.isArray(action) ||
      Object.keys(action).some((key) => !ACTION_KEYS.has(key)) ||
      !TOOL_NAMES.has(action.tool) ||
      typeof action.target_uid !== 'string' ||
      !knownUids.has(action.target_uid) ||
      (action.confirm !== undefined && typeof action.confirm !== 'boolean')
    ) {
      return invalid('unapproved_action');
    }
    toolCalls += 1;
    if (toolCalls > 8) {
      return invalid('tool_budget_exceeded');
    }
    const entry = executeTool(ledger, action, caseObj, 'victim');
    return {
      status: entry.approval_state === 'completed' ? 'completed' : 'blocked',
      tool: action.tool,
      target_uid: action.target_uid,
    };
  }

  return {
    visibleStart,
    step,
    evaluatorLedger: () => structuredClone(ledger),
    evaluatorInvalidEvents: () => structuredClone(invalidEvents),
  };
}
