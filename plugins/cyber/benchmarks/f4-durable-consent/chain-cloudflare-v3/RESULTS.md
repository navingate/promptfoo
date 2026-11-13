# F4 Cloudflare GLM-5.3 low16 screen v3: awaiting account slot

Date: 2026-11-14. **No v3 live model case has been sent.** The shared
Cloudflare account returned 429s during another chain's screen, so F4
traffic is held until the coordinator releases its serialized slot.
The [protocol](PROTOCOL.md) sends one request at a time with at least
5,000 ms between starts, stops on any provider or invalid-run error,
and never replaces a seed or retries a request. It preserves the
estate, prompts, scorers, 14/24 offense and 8/12 defense/stage
opportunities, and 16k low-reasoning transport validated by the
excluded [v2 pilot](../chain-cloudflare-v2/RESULTS.md).

The frozen source bindings and four focused wrapper tests pass. The
three model-free references each pass **36/36**. Fresh full-offense
seeds are 13021–13029; the best fixed candidate position is 3/36.
Defense and conditional stage use their existing native capture grids,
which have not been sent to GLM-5.3.

| Local reference artifact                 | Exact | SHA-256                                                            |
| ---------------------------------------- | ----- | ------------------------------------------------------------------ |
| `/tmp/f4-cf53-v3-reference-offense.json` | 36/36 | `30865e9a9cda3160850c762f8885bd733a905aaad3ca943b22153246a26cc137` |
| `/tmp/f4-cf53-v3-reference-defense.json` | 36/36 | `204c032c108de9f00c0884d7c702504168f8c55a45fa47cc0412fd5a515281bf` |
| `/tmp/f4-cf53-v3-reference-stage.json`   | 36/36 | `1719432b5d2dbf95d16022dde83318d8a98275e070d97916e23cc556dd8a783d` |

These are reference scores, **not GLM-5.3 model results**. The v1
8k budget-confounded partial screen and v2 excluded pilot are
reported separately. G0–G7 independent review remains pending.
