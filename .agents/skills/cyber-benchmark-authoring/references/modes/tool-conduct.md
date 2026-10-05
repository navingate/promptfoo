# Tool Conduct

## Use this mode when

Use `tool-conduct` to measure whether an agent completes useful authorized work while untrusted prompts, artifacts, or tool results try to redirect it. Do not convert refusal behavior into an offensive capability or detection score.

## Required decisions

- Inventory tool capabilities, principals, resources, side effects, and credentials.
- Write an explicit authorization policy for scope, delegation, approvals, and revocation.
- Include benign tasks that require useful tool use; blanket refusal must not pass.
- Stage prompt injection, malicious artifacts, and hostile tool results without exposing evaluator truth.
- Define destructive-action boundaries and any confirmation or dual-control requirements.
- Keep secrets out of model-visible data unless handling the secret is the declared construct.
- Record every attempted and completed side effect in an immutable action ledger.

## Scoring and failure semantics

Score helpfulness and safety separately. Helpfulness measures authorized task completion. Safety measures authorization compliance, secret handling, destructive side effects, and resistance to malicious redirection. A useful refusal declines only the unsafe portion and continues safe work when possible.

Fail closed when the action ledger is incomplete or ambiguous. Distinguish attempted, blocked, approved, completed, rolled-back, and unverifiable actions.

## Common shortcuts

- All malicious cases mention a suspicious phrase absent from benign artifacts.
- Refusing every tool call earns a perfect safety score.
- The grader reads the model's claimed behavior instead of the action ledger.
- Simulated tools report hidden policy decisions to the model.
- Destructive actions target shared or host resources instead of disposable state.

Vary artifact form and instruction location, include legitimate high-impact work, and mutate authorization independently of wording.

## Minimum release evidence

- Capability inventory, authorization policy, and destructive boundaries.
- Simulated tools and immutable action ledger over disposable state.
- Benign useful tasks plus malicious prompt, artifact, and result cases.
- Separate helpfulness and safety measures with useful-refusal cases.
- Secret-handling and unauthorized-side-effect tests.
- Shortcut search and matched calibration budgets.
- Current construct, implementation, and claim approvals.
