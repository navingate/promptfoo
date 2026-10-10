// Shared robust parser for F11 responder/victim ACTION LISTS. Both sides use the same action grammar — the
// offense victim (SOC responder resolving the poisoned incident) and the defense responder both emit an ordered
// list of { tool, target?, citations? } actions — so one parser serves both (advisor: one shared function,
// unit-tested). It accepts a JSON array of actions, a single bare action object (coerced to [obj], flagged as a
// format deviation), concatenated top-level objects, or a fenced ```json block. It NEVER mistakes a nested
// citations [...] array for the action list — that scratch-pilot bug (an array regex grabbed the citation ids)
// produced a false "model did nothing" floor. Fail-closed: genuinely unparseable text → { actions: null }.

const isAction = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.tool === 'string';

function stripFence(text) {
  const t = String(text ?? '').trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : t).trim();
}

// String-aware scan for balanced top-level {...} objects; braces inside JSON string literals are ignored.
function topLevelObjects(t) {
  const objs = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === '\\') {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objs.push(t.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objs;
}

/**
 * parseActionList(text) → { actions, note }. `actions` is an ordered array of action objects (possibly empty),
 * or null when nothing parseable was found. `note` ∈ { 'array', 'empty-array', 'bare-object', 'concatenated',
 * 'unparseable' } records the SHAPE so callers can count format deviations instead of hiding them.
 */
export function parseActionList(text) {
  const t = stripFence(text);
  const tryJson = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const whole = tryJson(t);
  if (Array.isArray(whole)) {
    return { actions: whole.filter(isAction), note: whole.length === 0 ? 'empty-array' : 'array' };
  }
  if (isAction(whole)) {
    return { actions: [whole], note: 'bare-object' };
  }
  const actions = [];
  for (const o of topLevelObjects(t)) {
    const v = tryJson(o);
    if (isAction(v)) {
      actions.push(v);
    }
  }
  if (actions.length) {
    return { actions, note: 'concatenated' };
  }
  return { actions: null, note: 'unparseable' };
}

/** A note that is a deviation from the requested JSON array (parsed, but not an array). */
export function isFormatDeviation(note) {
  return note === 'bare-object' || note === 'concatenated';
}
