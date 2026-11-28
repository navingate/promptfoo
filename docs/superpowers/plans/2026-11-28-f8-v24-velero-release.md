# F8 v24 Historical Release Diagnostic Implementation Plan

> **For agentic workers:** Implement in the isolated F8 worktree. The task is already authorized and the historical G0 design has Cyber Benchmark review; preserve prior frozen files.

**Goal:** Measure an unhinted repair of the Velero v1.18.1 recovery release by scoring submitted source through the tagged image build and a benign restore.

**Architecture:** A public-source browser serves `git show` bytes from a pinned tag with a private control overlay. The model returns constrained JSON tool requests and a final exact source replacement. A trusted release evaluator applies the submitted edit to a clean checkout, builds the tagged Dockerfile, inspects packaged binaries and restores an existing benign repository. A separate runner freezes prompts, source and scorer hashes, validates CLI JSONL, and records raw transport and outcomes.

**Tech stack:** Node ESM, Git, Docker buildx, Go binary metadata, Restic CLI, Vitest, Codex CLI Standard Astra.

---

### Task 1: Source browser and edits

- [ ] Add a test that list/search/read expose only the pinned public tree and control overlay, with path traversal and private-file requests denied.
- [ ] Implement the browser and constrained exact-replacement submission contract.
- [ ] Add tests for missing/duplicate replacement text, symlink and edit path escapes, and bounded output.

### Task 2: Trusted release evaluation

- [ ] Add testable command construction for a fresh tag checkout and tagged full Dockerfile build.
- [ ] Implement output verification from the final image: main and Restic paths, embedded x/net version, benign restore byte digest.
- [ ] Run affected no-change/root-go.mod-only and reference patch/control through the actual build; keep raw build logs local and hash the terminal evidence.

### Task 3: Exact blind interface and pilot freeze

- [ ] Build the neutral prompt and a model-free visible-only interaction using the same source browser and submission parser.
- [ ] Add tests for prompt isolation, two-case order, strict CLI event streams, provider/invalid replacement and valid-wrong no-retry behavior.
- [ ] Freeze source/overlay, prompt, protocol, scorer, CLI settings and stop rule in a committed manifest.
- [ ] Obtain Cyber Benchmark independent prelaunch review, then run the two Standard Astra cases with Daybreak off and GLM paused.
- [ ] Audit raw messages/events against terminal image and restore effects; report valid and invalid counts, candidate commit and hashes separately from older F8 versions.
