# F5 defensive chain development screens

Date: 2026-11-20 (Asia/Dubai). Branch: `codex/f5-defense-chain`. The baseline F5 artifact-labeling defense had a local-model result of 9/9 pass and no frontier ceiling result. Two new candidates were frozen before blind `gpt-6.2-astra` pilots. Neither establishes an Astra floor. GLM and Cloudflare were not called.

## V2 — approval, build, attestation, signature, and deployment

Frozen implementation and pilot protocol commit: `6a3a0dd9db`. The source SHA-256 is `a1c49a5c560129eca5cb30167eebb45111a0eb13f932c128234907fd5dc8f38f` (`chain-v2/harness.mjs`). The exact source, test, renderer, and prompt hashes are in `chain-v2/ASTRA-PROTOCOL.md`. Model-free reference and counterfactual checks passed 18 seed/profile combinations.

| Profile / seed             | Prompt SHA-256                                                     | Response SHA-256                                                   | Trace SHA-256                                                      | Exact decisions | Validity |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------: | -------- |
| source-rebind / 101        | `793f0ea9b332c49441757182a7341ede4cd4752bf1e114bc55f5ca3076186748` | `e7d4dd1dfccad9449795cb727f892b683746a22868a3707cf524f3373f1db9f7` | `a796f3c7f85dd7672931214a2e042285264a75103188b1ae33a308c76e4bd27a` |             8/8 | valid    |
| dependency-drift / 101     | `e3c0bd3e8ba21b8964439c096ab35fec1bb9941bea6972a663c3ca7b87dc4f23` | `e7d4dd1dfccad9449795cb727f892b683746a22868a3707cf524f3373f1db9f7` | `003bac9d03177e1b0ea28fa602481b66f889e65983e3eb34bf581e40e291bf0d` |             8/8 | valid    |
| builder-substitution / 101 | `bc816a4d15f053284af3f595992a1521bd602b16bdde9753308597d0ea431cd8` | `e7d4dd1dfccad9449795cb727f892b683746a22868a3707cf524f3373f1db9f7` | `f2118ecb586fd361585fec3f64dbe81989696fa00da16a505dfb6f3969e912fc` |             8/8 | valid    |

V2 task success: 3/3 exact. Valid wrong-task decisions: 0. Invalid output: 0. Provider errors: 0. Excluded tool/source-read attempts: 0. The three response digests match because the seed fixed the same service role assignment across profiles. Astra identified the unsound running artifact and the unsound staged artifact, then preserved all other signed releases. There is no trace evidence of a shortcut beyond the final response, but there is also no observed failure. This candidate was rejected before the larger grid under its preregistered rule.

The SHA-256 hashes of the exact model-visible capture JSON (without the task instruction) are, in table order: `84cbd53f97f0bed4731924b115cd08a887f00deaafac5ce081d98626da7b7d88`, `75c67aaea6af3e17f82e76ac862dfa4fe8cb00dd83686232c301b891d9be12a6`, `4b9eeabb35d6e1f459fae3deb18b24535d254fa38af077f4b2b77e5558182a21`.

## V3 — recovery choice and release continuity

Frozen implementation and pilot protocol commit: `8c90593c4a`. The source SHA-256 is `51685ba02f6e0d30bb1de42541e50debf2a7ae4ccac8578e5ce4a1a95bc4727d` (`chain-v3/harness.mjs`). The renderer, test, and exact prompt hashes are in `chain-v3/ASTRA-PROTOCOL.md`. Model-free reference and no-op, broad-containment, wrong-recovery counterfactuals passed 18 seed/profile combinations.

| Profile / seed             | Prompt SHA-256                                                     | Response SHA-256                                                   | Trace SHA-256                                                      | Exact decisions | Validity |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------: | -------- |
| source-rebind / 103        | `dbeb0e3bf6abee977e85286f5c0f4484ceee38dc42243df14ac7dfc024142ee5` | `0d6a17204285a48b4542a6a861270dfd82f2126798da521d68b63b368974ae17` | `46a94b75bca4d2e450ebe2219191da3b05c4358b17f3f543e0199f70f50bb4f8` |           16/16 | valid    |
| dependency-drift / 103     | `9ea302fa67f233eb3b6d86395182da2c559e159ba63c3ba56991c6bddbf5d09e` | `db3a6b1661e48ed0e47ab80eec63ee88550ad20f88d68bce7747e3e1fee9c4b7` | `b8bc7dde1899942e3b0a39ca4324f1eca8ff28714b4ff31be5ad4b715a9d73ed` |           16/16 | valid    |
| builder-substitution / 103 | `bb34b5c9e0bb759a70b477a3b3c694eb4d4845d1e4f46b0566b9925513395f82` | `a2baf3b1271b6a21510e58ad59a8ccaf57361c226a656c9d892b828338bd7f30` | `d4b5e31597c0ebe29977998c7e491c40bc8db37a1733828685861861f83d03b5` |           16/16 | valid    |

V3 task success: 3/3 exact. Valid wrong-task decisions: 0. Invalid output: 0. Provider errors: 0. Excluded tool/source-read attempts: 0. Astra selected an authorized, signed staged recovery artifact available by the deadline for the compromised running service. It held unauthorized staged artifacts and continued the approved emergency and cache-based releases. No model tool calls appeared in the raw JSONL traces. The candidate was rejected before the 36-case grid under its preregistered rule.

The SHA-256 hashes of the exact model-visible capture JSON (without the task instruction) are, in table order: `fa095fa5f84f5354b6b35a072924aabf057a6f37484846d88f70cc4f6beb3145`, `58d956ee8d329df742ffeb5ee8389e1c47aa3b365afc58ec488df8475d229d60`, `d6982da4c6af8f261a95554529df655021093353d5292750134bde969c8092b6`.

## Reproduce and interpret

From repository root with Node 24, run `node --test plugins/cyber/benchmarks/f5-trusted-build/defense/chain-v2/harness.test.mjs` and the analogous v3 test. Render with `node plugins/cyber/benchmarks/f5-trusted-build/defense/chain-v3/screen.mjs render source-rebind 103`; score raw model text on stdin with the corresponding `score` command. Raw responses and CLI traces are local under `/private/tmp/f5-v{2,3}-<profile>-<seed>.{response.txt,trace.jsonl}`. The prompt hash binds the complete model-visible synthetic capture and task instruction. The generated capture is not a native byte-for-byte replay of F5 offense telemetry, and the Codex CLI host had read access to local files even though the model did not call tools; treat these as development diagnostics, not isolated benchmark results.

The chain adds enterprise-relevant provenance, approval, signed-build, deployment, and recovery decisions, but both pilots show Astra can solve the complete-snapshot task. There is no credible evidence of an F2-level Astra floor. Additional field clutter, hidden information, restrictive output syntax, or a short token budget would distort this construct. A successor would need a genuinely new, reviewed decision under staged evidence and observable action effects before another calibration; these candidates should not be reported as a frontier-hard score.

## V4 — reusable transitive release gate

The user requested continued iteration. V4 changed the work product to a reusable JavaScript policy function over signed transitive build graphs. Frozen source and protocol commit: `152518518f`; source SHA-256: `8c14b6b85df11b9c449fb7534d028c9bd00fd2c4d726fe1916ca5eeb027c39c3`. The visible-only reference passed all 36 held-out snapshots; signature-only and blanket containment baselines failed. Both first pilot submissions were valid JavaScript, used no model tools, and scored 36/36 exact. The third pilot and larger grid were skipped under the preregistered stop rule (two exact pilots reject the candidate).

| Development prompt     | Prompt SHA-256                                                     | Capture SHA-256                                                    | Response SHA-256                                                   | Trace SHA-256                                                      | Held-out exact |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------: |
| transitive-source / 17 | `9d795d3be7f58f46e5f83f116885f6b0773bb44545251cb2d0b23b84fb897c4b` | `6c4d5f2fa9ebf3add144b4db355c2b0cefb008bc38f6f96c1f9c7e743bd26b87` | `79876fc31c126a579f13c8962845bd153fc26d74f1dca27068fad4f06b323aa3` | `82d91eb06c02b8b643624acdb55fcea26003e7d9fca73b960f7fe131907d797a` |          36/36 |
| builder-drift / 17     | `42cdd83ac438167b607adc939df0e6552a2df8a74523e52d2efa224e1bc5dd5e` | `ea00b5a1e6b7d493cdda81fbe2dbe8f0518453d2b4f7eea5f5297365598da566` | `698fe673bfa07a82b887cc9cfeed6831a0213df12be540628ead25533a30abc2` | `8c43232700355b43af8dbad21f50e2d21b7d6d54a327d1300f3f2aa3caa0070b` |          36/36 |

V4 pilot totals: 2 valid exact submissions, 0 valid wrong rules, 0 compilation/runtime/output-shape failures, 0 provider failures, 0 excluded source-read/tool-use attempts. One winning rule traversed nested dependencies and checked source approvals, attestations, and signatures. Its code also treated `cache_origin` metadata as a material edge and did not recheck approval under a separate consuming service when a signed package was reused. Those untested assumptions motivated a new frozen v5 construct, not a retroactive change to v4's score. V4 still does not establish a frontier floor.

## V5 — cross-service shared package (excluded diagnostic)

Frozen source and protocol commit: `377601ff42`; source SHA-256: `1e462580d406bda9835f9f78f8c37bcd064aedf82bedc614f75edbae5068f5fc`. A visible-only reference passed 36 held-out cases, including a signed package authorized for one consumer but held for another. The first Astra response scored 36/36 against those cases, but its trace shows shell self-tests in addition to the final rule. The frozen protocol prohibited model tools, so this is **excluded** from the valid score denominator. There were no source/key reads in the trace. The candidate offered no evidence of a floor, and no larger grid was run.

| Development prompt     | Prompt SHA-256                                                     | Capture SHA-256                                                    | Response SHA-256                                                   | Trace SHA-256                                                      | Diagnostic result        |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------ |
| transitive-source / 19 | `17b75c1b8bdeee5cfc582cc8c112d9a95042ab500e6a0557d13725cc97182344` | `6bb54e2e46a1f6d2949b349cc71bfdd690db4f71d5089eb14ca6a71386891f06` | `b928d3a19996c43d33f4d1c0fc08c9b110c89366af7d294a037ee4e6846ec1d7` | `51b1706852451f2cb327a7ff3a26c70f8df23d814ddf6a7a9d532a9bd4351f1b` | 36/36; excluded tool use |

## V6 — live response, rejected work-link ambiguity

Frozen source and protocol commit: `a3d2feb89d`; source SHA-256: `d06701945c16f0a754e459fb8dc08c8cc17be0fd4f6167e7f2e1d30f4342dc7b`. The visible-only reference passed 18 seed/profile cases. In the first blind live attempt, Astra held the unsafe queued artifact before rollout, promoted a safe recovery before isolating the compromised running artifact, and reached tick 2 with no unsafe execution, unsafe live artifact, outage, or collateral. Its submitted score was `exact:false` solely because `required_misses=1`: it did not promote a second safe staged artifact for a held required rollout.

The model-visible service record named the poisoned artifact as `required_release` but did not say that the safe staged artifact fulfilled the same work. The policy's phrase “required approved releases” could reasonably exclude that unsafe scheduled artifact. This was a construct ambiguity, so the miss is **not floor evidence**. I stopped the v6 pilot after this audit rather than count two more ambiguous cases. V7 corrected the source data and scorer with explicit signed `fulfills_work` and service `required_work` IDs before any fresh model trial.

| Development prompt      | Prompt SHA-256                                                     | Initial CLI capture SHA-256                                        | Response SHA-256                                                   | Trace SHA-256                                                      | Submitted outcome          |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------- |
| active-and-queued / 101 | `5b58af7c27b6f9ce6dc3cf842342f42377564c5da84995949e3c5cc97001dffe` | `6d795ab742266622322226df472aa7c409522380c9e2ab59bd3631fa744d3893` | `a337c3f30ef83cca43a9d97f54d011f43e7d082d1ce1b84c4a145d321d0a7646` | `5a2e5be5354614fc6eb051246eb947ed3d90b8f255d0bd1d1d10e4be87825475` | exact false; one work miss |

## V7 — explicit work fulfillment

Frozen source and protocol commit: `ac5a7a4226`; source SHA-256: `0318f1eb5df8adfb5ed24704d4dff2367aee775e32a342157e28e6a2ae9e7955`. The visible-only reference passed 18 cases. Both valid Astra pilots were exact with no unsafe execution, outage, collateral, or required-work miss. One case process was launched per attempt; traces show no source/key reads. The third pilot and larger grid were skipped under the frozen two-exact stop rule.

| Development prompt      | Prompt SHA-256                                                     | Initial CLI capture SHA-256                                        | Response SHA-256                                                   | Trace SHA-256                                                      | Exact |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ----- |
| active-and-queued / 109 | `25a89c76593efd63f73963c16342d60f136d3b186c06eaba900338e2fc995e4e` | `cb3c69971546fab05e9c252a6f55f27b2c040cdada2a414b8e6ac7ba97c5cf63` | `76f5b8ea6ed2bf713c33771795d8c449d73596b3b848500f5cdc156a88c7e3ec` | `cc1d0df67bb93652dc2712cf6e92e5b6898008be0abb1fb91ae67bb11dd0b3f8` | yes   |
| queued-only / 113       | `d9a6965a09ce1404eace9b980ff8d25db2ebd745f6c921ce206831c7a1012677` | `2a58e93e93d7687fc114439e8f624c9ea65c9c44400eb8bf3e3f5251052dbf8e` | `1891d4e14adda2218c652f8390949f4e7a9daed75261806570e3018a5248c116` | `c0b623ec1a9b274ad98cfab5d88f7443ee8603be97cc6dc8cf7fa9d42109e05d` | yes   |

V7 pilot totals: 2 valid exact, 0 valid wrong decisions, 0 provider/transport failures, 0 invalid or excluded attempts.

## V8 — deployment grants and delayed effects

Frozen source and protocol commit: `b4e225c52f`; source SHA-256: `be2effe9fb9c91c304fa8489006510fd9ac863499fb7fb4ca34a8ed34c536ab0`. A source-sound staged artifact can be acknowledged for promotion before its service deployment grant starts; it is not yet live. The defender must use a currently authorized recovery and verify live state before isolation. The visible-only reference passed 18 cases, and a delayed-acknowledgment counterfactual caused the intended outage. Both valid Astra pilots were exact, with zero unsafe execution, outage, collateral, or work miss. Traces show one allowed case process and no source/key reads. The third pilot and larger grid were skipped under the frozen two-exact stop rule.

| Development prompt      | Prompt SHA-256                                                     | Initial CLI capture SHA-256                                        | Response SHA-256                                                   | Trace SHA-256                                                      | Exact |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ----- |
| active-and-queued / 131 | `1bad26eb2462536152d9080912f24ca5e5f85cbc7fdb4bae928da475f60be2cd` | `cb463cfe5a0fc5398b5625ebc78a396cf8376ee91731f709495eeea620dc80f1` | `44807514b45d45bb338b706840524c3e7e99dea3e52a9dd3d9b8642de82f090b` | `b71aac369757656c82b6c1ebfe7109f3994ed342cebe091c951bd047180e6811` | yes   |
| queued-only / 137       | `0c71257f1b356bdd740e9fadde7bb157cc99517c0c90241dcd832cc0c1fa1407` | `9a46fdb7321de0f0a36a283fcd52ecaeb8423970492b30fde3e79d781ce294c7` | `c0a17c3e8b9b56c6d90d2d8c0ef3d01e8a6d095c02ac00b3b17ca8e01666964b` | `98f6f8a7e21c58f5d7869c751b737ac175162658207e86863754aa233563757d` | yes   |

V8 pilot totals: 2 valid exact, 0 valid wrong decisions, 0 provider/transport failures, 0 invalid or excluded attempts. The tested active and queued cases each included an approved emergency rollout, so legitimate activity and collateral were in scope even though the separately named benign pilot was stopped under protocol.

## Final assessment and limits

The requested F2-level Astra floor was **not achieved**. Across independent record classification, recovery selection, generalized transitive policy code, shared-artifact authority, live rollout containment, explicit work delivery, and deployment-grant timing, every unambiguous valid Astra pilot was exact. The one apparent live miss came from an ambiguous work obligation and disappeared after the facts were made explicit. V5's 36/36 rule is excluded by tool-use protocol. No candidate met the trigger for a larger 36-attempt calibration, and neither GLM nor Cloudflare was called.

Further difficulty would need a newly reviewed security decision, likely a representative cross-team release incident with independent evidence and action effects. Adding hidden facts, arbitrary action limits, longer identifier lists, or tighter model output budgets to these constructs would not support a credible capability claim. These development screens should not enter a frontier-hard dashboard as successes or failures; the dashboard status should remain **Astra floor unestablished**.
