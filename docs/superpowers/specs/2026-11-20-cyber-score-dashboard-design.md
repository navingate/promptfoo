# Cyber benchmark score dashboard

## Decision

Build an owner-private hosted dashboard for the ten F2–F11 benchmark families. It reads a small, versioned score registry committed to the `navingate/promptfoo` fork. The dashboard refreshes that registry on load, when the tab regains focus, and at a short interval while open. New score publications update the page without rebuilding or redeploying it.

The dashboard reports observed benchmark results, not a model safety certification. Offense and defense remain separate measures. It does not average across chains, mix models, or treat different defense constructs as interchangeable.

## Data contract

Store `plugins/cyber/scoreboard/scores.json` in the fork. Its schema version is explicit. Each immutable run record contains:

- Family ID and name; offense or defense; the specific measured construct and primary metric/unit.
- Model and endpoint IDs; candidate version; score numerator and denominator; valid attempts, provider errors, and format failures when reported.
- Scored date, source commit, immutable GitHub evidence URL, and result status (`release`, `scored_screen`, `local_probe`, or `inconclusive`).
- A short caveat when a reported result has an important interpretation limit.

The registry lists all ten families even when a family or side has no result. Absence is rendered as **Pending**, never `0/0` or `0%`. Historical run records remain available; a new run is appended, not used to rewrite an earlier result. A small publisher/validator accepts normalized JSON input, checks schema and arithmetic, rejects duplicate run IDs and unsafe URLs, and writes the registry deterministically. The publisher does not infer scores from arbitrary Markdown or silently select a "best" result. Source evidence is reviewed when adding a record.

The initial registry is curated from the existing committed score reports. GLM-5.3 results are presented as one model filter. Local Qwen probes and any GLM-5 results have their own model filters and status badges. In particular, F3's interactive response result is labeled as that adjunct; it is not presented as the original detection twin. F4 defense stays pending until its current candidate has a scored result.

## Site and update path

Use a small static HTML/CSS/JavaScript Site with no runtime secrets or database. It fetches the public fork's score registry using a cache-busting request. The initially deployed Site stays owner-private. GitHub is the score source of truth; the Site holds only a bundled, dated fallback snapshot for temporary fetch failures. Any fallback is visibly marked stale.

The default view is a ten-row matrix with offense and defense cells. A cell shows the exact fraction, metric, version, status, and a direct evidence link. Filters select model and status; expanding a cell shows validity/errors and historical runs. The page shows its last successful source check and a visible refresh control. It uses `textContent` or equivalent safe rendering for registry strings, never injects them as HTML.

Once a new result is committed to the registry branch, the page reflects it at its next refresh. The first deployment may read the dashboard feature branch so it works before its PR merges; after merge, the source is switched to the fork's `main`. Publication of an uncommitted calibration trace is outside the live feed. The team uses the publisher whenever a calibrated run is frozen, so the new result is one reviewable commit rather than a page edit.

## Failure behavior and limits

- A failed fetch leaves the last verified snapshot visible with a stale warning and check time. Invalid JSON or schema is rejected as a whole; the page does not mix old and new records.
- A new version cannot silently replace an older result. Status and metric labels stay visible, and history remains accessible.
- No raw model transcripts, credentials, or synthetic secrets are copied into the registry or Site.
- The dashboard is live with **published score records**. It cannot know that a local or uncommitted experiment finished, and it does not claim real-time inference or statistically comparable scores across unlike tasks.

## Verification and acceptance

1. Validate the seeded registry against its cited committed reports, including numerator, denominator, model, version, and status.
2. Test the publisher on duplicate IDs, negative/out-of-range counts, missing evidence, malformed status, and deterministic round trips.
3. Serve the Site locally and check desktop/mobile layout, filters, history, pending states, stale-source behavior, and refresh after a test registry update.
4. Publish the private Site, verify its deployed URL and owner-only access, and confirm the hosted page reads the same registry as the local preview.
5. Document the exact command and review step for adding a future scored run. No manual edit to the hosted page is required.
