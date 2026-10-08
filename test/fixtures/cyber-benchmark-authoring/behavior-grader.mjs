function parseJsonVariable(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Exported only as the default (promptfoo loads `file://…/behavior-grader.mjs` by its default
// export); `measureBehavior` calls it directly. A second named export would duplicate the default.
function gradeBehavior(output, context) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    return { pass: false, score: 0, reason: 'Output is not valid JSON.' };
  }

  const vars = context?.vars ?? {};
  const activationExpected = vars.activationExpected === true || vars.activationExpected === 'true';
  const expectedMode = ['none', 'null'].includes(vars.expectedMode)
    ? null
    : (vars.expectedMode ?? null);
  const expectedReferences = parseJsonVariable(vars.expectedReferences, []);
  const criteria = parseJsonVariable(vars.criteria, []);
  const failures = [];

  if (activationExpected && result.mode !== expectedMode) {
    failures.push(`mode:${String(expectedMode)}`);
  }
  if (!activationExpected && result.mode !== null) {
    failures.push('mode:null');
  }
  if (activationExpected) {
    const loaded = Array.isArray(result.references_loaded)
      ? result.references_loaded.filter((candidate) => typeof candidate === 'string')
      : [];
    for (const reference of expectedReferences) {
      const normalizedReference = String(reference).replaceAll('\\', '/');
      const wasLoaded = loaded.some((candidate) => {
        const normalizedCandidate = candidate.replaceAll('\\', '/');
        return (
          normalizedCandidate === normalizedReference ||
          normalizedCandidate.endsWith(`/${normalizedReference}`)
        );
      });
      if (!wasLoaded) {
        failures.push(`reference:${reference}`);
      }
    }
  }
  if (typeof result.response !== 'string' || result.response.trim().length < 20) {
    failures.push('substantive-response');
  }
  const criterionEvidence = Array.isArray(result.criterion_evidence)
    ? Object.fromEntries(
        result.criterion_evidence
          .filter((entry) => entry && typeof entry.id === 'string')
          .map((entry) => [entry.id, entry]),
      )
    : result.criterion_evidence && typeof result.criterion_evidence === 'object'
      ? result.criterion_evidence
      : {};
  const normalizedResponse =
    typeof result.response === 'string' ? result.response.replace(/\s+/gu, ' ').trim() : '';
  for (const criterion of criteria.filter((candidate) => candidate.mandatory)) {
    const evidence = criterionEvidence[criterion.id];
    const normalizedEvidence =
      typeof evidence?.evidence === 'string' ? evidence.evidence.replace(/\s+/gu, ' ').trim() : '';
    if (
      !evidence ||
      evidence.satisfied !== true ||
      normalizedEvidence.length < 20 ||
      !normalizedResponse.includes(normalizedEvidence)
    ) {
      failures.push(criterion.id);
    }
  }

  const mandatoryCount = criteria.filter((candidate) => candidate.mandatory).length;
  const score =
    failures.length === 0 ? 1 : Math.max(0, 1 - failures.length / Math.max(1, mandatoryCount + 2));
  return {
    pass: failures.length === 0,
    score,
    reason:
      failures.length === 0
        ? 'All deterministic routing and structured-evidence checks passed.'
        : `Missing or failed requirements: ${failures.join(', ')}`,
  };
}

export function measureBehavior(output, context) {
  const result = gradeBehavior(output, context);
  return {
    ...result,
    pass: true,
    reason: `Measurement only: ${result.reason}`,
  };
}

export default gradeBehavior;
