export function validateEventStream(jsonl, response) {
  let events;
  try {
    events = jsonl
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  } catch {
    return { complete: false, reason: 'malformed-jsonl', tool_items: 0 };
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
    return { complete: false, reason: 'malformed-jsonl', tool_items: 0 };
  }
  if (events.some((event) => event.type === 'error' || event.type?.endsWith('.failed'))) {
    return { complete: false, reason: 'failed-turn', tool_items: 0 };
  }
  const indexes = (type) => events.flatMap((event, index) => (event.type === type ? [index] : []));
  const threadStarted = indexes('thread.started');
  const turnStarted = indexes('turn.started');
  const turnCompleted = indexes('turn.completed');
  const agentMessages = events.flatMap((event, index) =>
    event.type === 'item.completed' && event.item?.type === 'agent_message'
      ? [{ index, text: event.item.text }]
      : [],
  );
  if (
    threadStarted.length !== 1 ||
    turnStarted.length !== 1 ||
    turnCompleted.length !== 1 ||
    agentMessages.length !== 1 ||
    !(
      threadStarted[0] < turnStarted[0] &&
      turnStarted[0] < agentMessages[0].index &&
      agentMessages[0].index < turnCompleted[0]
    ) ||
    turnCompleted[0] !== events.length - 1
  ) {
    return { complete: false, reason: 'missing-or-duplicate-terminal-event', tool_items: 0 };
  }
  if (
    typeof agentMessages[0].text !== 'string' ||
    agentMessages[0].text.trim() !== response.trim()
  ) {
    return { complete: false, reason: 'final-message-mismatch', tool_items: 0 };
  }
  const toolItems = new Set(
    events.flatMap((event, index) =>
      event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type)
        ? [event.item.id ?? `event-${index}`]
        : [],
    ),
  );
  return { complete: true, reason: null, tool_items: toolItems.size };
}
