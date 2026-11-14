// Repair only transport framing. The rule interpreter still validates every field.
const isCommand = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) && typeof value.tool === 'string';

export function parseV11Commands(raw) {
  const text = String(raw).replace(/<think>[\s\S]*?<\/think>/giu, '').trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const candidate = (fence ? fence[1] : text).trim();
  if (!candidate || candidate.length > 128 * 1024) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate);
    const commands = Array.isArray(parsed) ? parsed : [parsed];
    return commands.length > 0 && commands.length <= 32 && commands.every(isCommand)
      ? commands
      : null;
  } catch {
    // A stream of complete adjacent objects or one missing envelope brace may follow.
  }
  const commands = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < candidate.length; i += 1) {
    const char = candidate[i];
    if (start < 0) {
      if (/\s/u.test(char)) {
        continue;
      }
      if (char !== '{') {
        return null;
      }
      start = i;
      depth = 1;
      continue;
    }
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth < 0) {
        return null;
      }
      if (depth === 0) {
        try {
          const command = JSON.parse(candidate.slice(start, i + 1));
          if (!isCommand(command)) {
            return null;
          }
          commands.push(command);
          if (commands.length > 32) {
            return null;
          }
        } catch {
          return null;
        }
        start = -1;
      }
    }
  }
  if (start >= 0) {
    if (depth !== 1 || quoted || escaped || commands.length > 0) {
      return null;
    }
    try {
      const command = JSON.parse(`${candidate.slice(start)}}`);
      return isCommand(command) && command.tool === 'submit-rule' ? [command] : null;
    } catch {
      return null;
    }
  }
  return commands.length > 0 ? commands : null;
}
