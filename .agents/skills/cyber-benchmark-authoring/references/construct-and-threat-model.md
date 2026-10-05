# Construct and Threat Model

## One primary construct

State one primary construct as a decision the model must make or an outcome it must cause. Define its deterministic boundary and the evidence that distinguishes success from failure. Supporting behavior may add context, but it cannot become a second hidden score.

For offense, frame the objective as whether the model can penetrate standard enterprise defenses inside authorized synthetic scope. Name the defense or trust decision being crossed. Credential discovery, identity federation, IAM, storage, persistence, and exfiltration are possible contexts, not mandatory hops.

For defense, incident response, and tool conduct, keep the corresponding detection, response, and authorization constructs separate from offensive capability.

## Threat-model record

Record:

- principals, roles, workloads, sessions, and ownership;
- assets, protected state, credentials, and destructive resources;
- trust boundaries and the controls enforced at each boundary;
- authorized behavior, malicious behavior, and ambiguous behavior;
- adversary starting state, knowledge, permissions, and objective;
- evaluator authority and facts that must stay outside the observation plane;
- success and failure predicates, expected denial points, and recovery state;
- causal chain, matched benign neighbor, and a negative mutation per intended link;
- assumptions, exclusions, intended evidence, narrow claim, and explicit nonclaims.

Obtain design approval before implementation. The construct reviewer confirms that the task measures the declared decision; the auditor can verify only the approval's freshness and bindings.

## Counterfactual standard

For every signal expected to support a positive result, create a matched benign case that preserves nearby privileged activity while changing the decisive causal fact. Include blocked, abandoned, failed, successful, and benign outcomes when they make the decision boundary meaningful.

Test obvious alternatives before calibration: literals, presence, identifiers, denial state, event count, sequence length, timing, and final impact. If one solves the task without the intended reasoning, redesign the corpus or narrow the construct.

## Complexity and adoption budget

Before adding a service, hop, protocol, product, event type, or volume, answer:

1. Which model decision or failure mode changes?
2. Can that effect be tested deterministically?
3. Does it improve construct validity, transfer evidence, or a declared robustness diagnostic?
4. Can a cheaper portable simulation preserve the same semantics?
5. Does it add provider-speed, infrastructure, reliability, or cleanup confounds?

Prefer one to three meaningful boundaries. Use real products only when product behavior is the primary construct or the intended claim requires product fidelity. Otherwise use a portable simulation of principals, credentials, trust, authorization, state transitions, protected assets, native events, benign counterfactuals, and credible failure outcomes.

Long chains are justified only when cross-boundary composition is the construct. Report per-stage survival so compounded minor errors are visible.
