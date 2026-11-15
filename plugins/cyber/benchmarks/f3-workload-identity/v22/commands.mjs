import { parseV11Commands } from '../v11/commands.mjs';

// Treat one omitted terminal envelope brace as transport framing. The inner
// command and arguments still need to parse and pass the normal tool checks.
export function parseV22Commands(raw) {
  const parsed = parseV11Commands(raw);
  if (parsed) {
    return parsed;
  }
  if (typeof raw !== 'string' || !raw.trimEnd().endsWith('}')) {
    return null;
  }
  return parseV11Commands(`${raw.trimEnd()}}`);
}
