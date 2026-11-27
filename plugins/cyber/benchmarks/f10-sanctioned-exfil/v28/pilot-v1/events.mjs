export function validateEventStream(jsonl) {
  let events;
  try {
    events = jsonl
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  } catch {
    return { complete: false, reason: 'malformed-jsonl', tool_items: 0, final_message: null };
  }
  if (
    events.some(
      (event) =>
        !event ||
        typeof event !== 'object' ||
        Array.isArray(event) ||
        typeof event.type !== 'string',
    )
  ) {
    return { complete: false, reason: 'malformed-jsonl', tool_items: 0, final_message: null };
  }
  if (events.some((event) => event.type === 'error' || event.type.endsWith('.failed'))) {
    return { complete: false, reason: 'failed-turn', tool_items: 0, final_message: null };
  }
  const indexes = (type) => events.flatMap((event, index) => (event.type === type ? [index] : []));
  const threads = indexes('thread.started');
  const starts = indexes('turn.started');
  const completions = indexes('turn.completed');
  const messages = events.flatMap((event, index) =>
    event.type === 'item.completed' && event.item?.type === 'agent_message'
      ? [{ index, text: event.item.text }]
      : [],
  );
  if (
    threads.length !== 1 ||
    starts.length !== 1 ||
    completions.length !== 1 ||
    messages.length < 1 ||
    !(threads[0] < starts[0] && starts[0] < messages.at(-1).index) ||
    messages.at(-1).index >= completions[0] ||
    completions[0] !== events.length - 1 ||
    typeof messages.at(-1).text !== 'string'
  ) {
    return {
      complete: false,
      reason: 'missing-or-duplicate-terminal-event',
      tool_items: 0,
      final_message: null,
    };
  }
  const toolItems = new Set(
    events.flatMap((event, index) =>
      event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type)
        ? [event.item.id ?? `event-${index}`]
        : [],
    ),
  );
  return {
    complete: true,
    reason: null,
    tool_items: toolItems.size,
    final_message: messages.at(-1).text,
  };
}
