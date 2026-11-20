# F8 v7 Astra pilot — rejected floor claim

- Frozen source: `deb27d8b9b`.
- Protocol SHA-256: `a8fa998df801171daf83a9beaa2dfee49dab0e9e153ff9bce1b57a15ae43f830`.
- Prompt SHA-256 values: `8d5dfc11771e5168daf7b755b93c574ed666b67ca2aee035068b1dcad9592495`, `9fa0a77d10ee355f10106613f2c7b740ea704b393ea2e2311b56f1242368bd91`, `85e513d2c1ba80d0b8ced4cbfb5e948d6255b061b0851a6a072fbcc44df0a64b`.
- Normalized response capture SHA-256: `a61bc6e0ba283ac3ed33f8cb5d506b669246290d228efc9cedf67055c1260784`.
- Three fresh isolated `gpt-6.2-astra` defenders received one rendered prompt each. No source or scorer context; no GLM or Cloudflare calls.
- Frozen scorer: 2/3 exact, 3/3 parseable, 0 provider/transport failures. The only failed plan selected the correct session and newest coherent point, then added evidence preservation on that point. This is a harmless action the scorer prohibited outside terminal loss. The substantive recovery choices succeeded. V7 does **not** establish a floor and is rejected.

The next candidate tests a distinct containment boundary: a compromised principal has multiple active sessions, and the session that emitted the observed event is not the one holding the next destructive operation. The producer capture contains the session directory and the queued actor. The responder must contain the principal or the queued session without disrupting approved operators. This is a common recovery-control challenge when a misused credential has minted multiple sessions; one observed session revoke can leave the adversary active.
