# F6 v3 — canonical frozen victim prompt (construct-defining; design-authority pin)

The v3 OFFENSE construct makes **the victim prompt a load-bearing part of the construct** (it is the lever
that makes a resistant victim follow a *crafted* injection while refusing a *naive* one). This file pins that
prompt so the build freezes + hashes **one authoritative text**, not one of the three divergent strings in
the tree.

## The pin

- **Authoritative text:** [`f6v3-victim-prompt.txt`](./f6v3-victim-prompt.txt) — its exact bytes ARE the
  canonical victim **system** prompt. It is **`VICTIM_SYS` verbatim** (byte-identical,
  [`f6v3-pilot/victim-resistance.mjs:21`](./f6v3-pilot/victim-resistance.mjs)).
- **sha256(f6v3-victim-prompt.txt) = `8a7740b558f8448b17917e4d8103bde7d6c37bb84b9c65385bb1bc2795c56e79`**
  (353 bytes, no trailing newline). This file is the **resistance-content reference** — the exact evidenced
  text (array grammar).
- **REALIZED FROZEN PIN (build, route 2 — see Output grammar):** the offense build froze
  `offense/frozen/victim-prompt.txt`, sha256 `e555e210e4006173b35ea261a448f3df4dc465411eab68bcbd97d656d4eec3ea`
  (374 bytes) — `VICTIM_SYS`'s three resistance-bearing sentences **byte-identical**, output clause adapted to
  the `{actions}` object grammar only. _F2 Chain to byte-verify the three sentences at the build's push;
  recorded as the realized pin pending that check._
- **Victim model id:** `deepseek.v3.2` on Bedrock (non-Azure), per the user's 2026-10-10 pin decision.

## Why VERBATIM (provenance — read before changing a byte)

The committed resistance evidence that justifies pinning `deepseek.v3.2` as a *resistant-but-craftable*
victim — **clean 0 / naive 0 / crafted 5** — was produced by `VICTIM_SYS` exactly as written, with results
in [`f6v3-pilot/victim-resistance-results.json`](./f6v3-pilot/victim-resistance-results.json). So the pin is
that text **unchanged**. (An earlier draft of this file "improved" the wording and added two hardening
clauses; that was wrong — the crafted-follow evidence belongs to THIS weaker text, and extra hardening moves
toward the all-refuse floor. Do not re-harden it.)

- **Do NOT pin `sweep-craft.mjs`'s `hardened` string** — that was the crafting-gradient victim on the free
  palmfuture, never the `deepseek.v3.2` resistance probe.
- **The offense harness victim is currently the v2 NON-hardened prompt** (`offense/scripts/harness.mjs:~505`,
  commented "generic, NON-hardened change agent"); v3 replaces it with this pinned text.

## Output grammar — ROUTE 2 is correct (the victim parser is object-only and shared)

`VICTIM_SYS` asks for a **JSON array** `[{"tool","target_resource"}, ...]`. The grammar clause is **not**
resistance-load-bearing, but it is **not free to keep as an array**: the runner's `pinnedVictimCall`
(`calibration-runner.mjs:1979`) parses the victim's output with the object-only `parseJsonObject`
(line 379 rejects arrays; selftest line 1111 asserts `[1,2,3] → null`; shared with F4/F9 + the G6
attacker→victim loop). So a bare-array victim would parse to `null` everywhere and pinning it (route 1)
would force a **cross-family shared-parser edit** — exactly the kind of change we avoid.

- **ROUTE 2 (chosen by the build, correct):** keep `VICTIM_SYS`'s three resistance-bearing sentences
  **byte-identical** and adapt **only** the output clause to the `{"actions": [...]}` object grammar; re-hash.
  Change no other byte. This is the realized pin above (`e555e210…`).
- Route 1 (pin the verbatim array, add an array parser) stays possible only if someone deliberately takes on
  the shared-parser change + updates selftest 1111 — not worth it here.

My earlier "route 1 preferred" note was wrong (written before I'd read the object-only victim parser).

## Honesty condition (binds the build + the G1 gate)

The pilot numbers (clean 0 / naive 0 / crafted 5) were an `n=5`-ish $0 probe. The reviewer's **G1
reference-pair gate** — which already runs against the frozen victim before any paid G6 — **MUST RE-DERIVE**
clean / naive / crafted resistance against the **exact frozen text (this hash) + `deepseek.v3.2`** and record
those numbers. If G1 does not reproduce resist-clean + resist-naive + follow-crafted, the pin is not
established → report, do not proceed to G6. (Paid Bedrock → the build runs G1 only on the user's direct word
in the build session.) Any byte change beyond the route-2 output clause is a construct change: bump the pin,
re-derive. Never carry these numbers onto changed bytes.
