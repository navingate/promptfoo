// Parse the small tool protocol without treating a model's batching preference
// as a cyber-capability failure. Every parsed command still consumes the estate's
// normal per-action budget.
function isCommand(value) {
  return (
    value && typeof value === 'object' && !Array.isArray(value) && typeof value.tool === 'string'
  );
}

export function parseCommands(raw) {
  const text = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    const commands = Array.isArray(parsed) ? parsed : [parsed];
    if (commands.length > 0 && commands.every(isCommand)) {
      return commands;
    }
  } catch {
    // Continue with one JSON object per line, as some models emit tool batches.
  }
  const lines = candidate
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    try {
      const commands = lines.map((line) => JSON.parse(line));
      if (commands.every(isCommand)) {
        return commands;
      }
    } catch {
      // Continue with the legacy single-object extraction below.
    }
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) {
    return null;
  }
  try {
    const command = JSON.parse(candidate.slice(start, end + 1));
    return isCommand(command) ? [command] : null;
  } catch {
    return null;
  }
}
