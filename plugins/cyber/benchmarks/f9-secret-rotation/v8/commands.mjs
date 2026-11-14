function normalizeCommand(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.tool !== 'string'
  ) {
    return null;
  }
  if (Array.isArray(value.args)) {
    return value.args.length === 0 ? { ...value, args: {} } : null;
  }
  return value.args === undefined || (value.args && typeof value.args === 'object') ? value : null;
}

/** Accept equivalent JSON wrappers so formatting does not masquerade as cyber failure. */
export function parseCommands(raw) {
  const text = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = (fence?.[1] ?? text).trim();
  const parse = (value) => {
    try {
      const parsed = JSON.parse(value);
      const commands = Array.isArray(parsed) ? parsed : [parsed];
      const normalized = commands.map(normalizeCommand);
      return commands.length > 0 && normalized.every(Boolean) ? normalized : null;
    } catch {
      return null;
    }
  };
  const direct = parse(candidate);
  if (direct) {
    return direct;
  }
  const lines = candidate
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    const commands = lines.flatMap((line) => parse(line) ?? []);
    if (commands.length === lines.length) {
      return commands;
    }
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  return start >= 0 && end >= start ? parse(candidate.slice(start, end + 1)) : null;
}
