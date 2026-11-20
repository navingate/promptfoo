# F8 v3 Astra pilot — policy gap

- Frozen source: `5f33078ac2`.
- Protocol SHA-256: `08a0cbbb05ab1fcd0514876d8735f57c0c598ce7d21370c2c2333885fb00e1df`.
- Prompt SHA-256 values: `d854116dc10e47ad1c6e53a9a483188aa481a68a40564e51ad465491a463db49`, `b8b1b717910ca2b3fa6a216587715171558eae1c530d06c89a2663c821f34d66`, `66491ff55d661d2f0e28edb49e26c3e6305f79b34f0b2715f10903f076d4cfc2`.
- Normalized response capture SHA-256: `38ef2b02add163b82b0f3a9a139b09541b9ba2aa5a7b872f435898cb13e0618c`.
- Three fresh isolated `gpt-6.2-astra` defenders received one rendered prompt each. No source or scorer context; no GLM or Cloudflare calls.
- Score: 0/3 exact, 3/3 parseable, 0 provider/transport failures. **Rejected as a floor claim.**

In both malicious cases Astra correctly identified the unauthorized session, sealed a viable point, and verified containment/recovery. It closed without escalation. The v3 prompt specified escalation only for terminal loss, while the scorer silently required it in all malicious cases. The benign DR-test answer verified recovery before closure, which is non-destructive and operationally reasonable, but the scorer allowed verification only after incident containment. The v4 policy states the all-stage escalation and closure boundary explicitly and permits recovery checks on authorized work. These corrections keep task failure tied to a visible decision rule.
