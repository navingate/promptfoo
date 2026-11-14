# F3 v14 de-oracle implementation plan

1. Add failing tests for identical training/hidden projection and for a
   complete reference rule under that projection. The tests must show a
   direct `causal_ref` rule fails while the field-based reference succeeds.
2. Add a v14-only projection flag to the existing v10 defense session.
   Project native events at the training-query boundary and hidden-evidence
   boundary; leave native producer and v10–v13 defaults unchanged.
3. Add a v14 wrapper, reference rule, guide, runner version, and README.
   The reference changes joins only; syntax, labels, and scoring stay fixed.
4. Run focused tests, old-version regressions, two 36-case model-free grids,
   independent native analysis, and replay of v13 winning rules on unscored
   cases. Freeze and commit the candidate.
5. Preregister unused Cloudflare GLM-5.3 seeds, run an excluded pilot, then
   score serially with the eighth-exact-pass stop. Commit aggregate results
   and raw hashes only; keep private captures out of Git.
