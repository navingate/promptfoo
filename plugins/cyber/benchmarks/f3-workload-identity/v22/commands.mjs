import { parseV11Commands } from '../v11/commands.mjs';

// Repair only terminal JSON framing, never command content. Each newline
// separated command may omit or add one outer brace; larger damage, prose,
// and malformed arguments still fail parsing or tool validation.
export function parseV22Commands(raw) {
  const parsed = parseV11Commands(raw);
  if (parsed) {
    return parsed;
  }
  if (typeof raw !== 'string' || raw.length > 128 * 1024) {
    return null;
  }
  const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/giu, '').trim();
  const fence = withoutThinking.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const lines = (fence ? fence[1] : withoutThinking)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 32) {
    return null;
  }
  const commands = [];
  for (const line of lines) {
    if (!line.startsWith('{') || !line.endsWith('}')) {
      return null;
    }
    let command = null;
    for (const candidate of [line, line.slice(0, -1), `${line}}`]) {
      try {
        command = JSON.parse(candidate);
        break;
      } catch {
        // Try exactly one terminal brace repair.
      }
    }
    if (!command || Array.isArray(command) || typeof command.tool !== 'string') {
      return null;
    }
    commands.push(command);
  }
  return commands;
}
