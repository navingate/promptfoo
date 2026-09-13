# Where Inspect actually runs code — and why the VM is the boundary (Gate 0A.4)

The security review's load-bearing point: a Docker Compose network is **not** the
containment boundary, because Inspect does not run everything inside the per-sample
sandbox container.

## What runs where

Per Inspect's sandboxing model (https://inspect.aisi.org.uk/sandboxing.html):

- The **sandbox** (`sandbox: docker` / a task `compose.yml`) is where the
  **target** and tool-executed commands run, per sample.
- The **eval process itself** — the task, the **solver/agent** orchestration, and
  the **scorer** — runs in the **host Python process**, i.e. wherever `inspect
eval` was launched. Custom agents, tools, and scorers execute there, **outside**
  the sandbox container.

So a control that only constrains the sandbox container's network (Compose
`internal: true`) leaves the solver/scorer/eval process free to reach the network.
That is exactly the gap Gate 0A closes.

## The Gate 0A consequence

Because the eval/solver/scorer run on the host, "the host" must itself be the
disposable, egress-denied boundary — not the laptop. Gate 0A therefore:

- runs the **entire** eval (host process + sandbox) **inside a disposable VM**
  (`deploy/colima-0a.yaml`), and
- applies the deny-by-default egress at the **VM** layer
  (`deploy/egress-lockdown.sh`), covering **both** the VM host (OUTPUT — eval /
  solver / scorer) **and** forwarded container traffic (DOCKER-USER — target /
  tools).

## The proof, not the claim

`deploy/egress-selftest.sh` probes from **both** contexts — the VM host (the
solver/scorer origin) and a container on a docker network — and fails the run
unless internet / IMDS / external DNS / IPv6 are all unreachable while only the
model endpoint is reachable. Passing that self-test is the Gate 0A acceptance
criterion; it is what lets us say "contained" instead of merely "documented."

Gate 0A is host-shared VM isolation — adequate for **non-sensitive dev
diagnostics**. Assurance-grade containment (microVM, brokered model calls,
out-of-band stage verification) is Gate 0B; sensitive tasks and deployment claims
wait for it.
