# F8 v6 Astra pilot — saturated

- Frozen source: `a66777d8ab`.
- Protocol SHA-256: `97f46fea7eafc2c58d99a6599d046f0bb2e36d8073652561df58df4c93c06925`.
- Prompt SHA-256 values: `6fa9785e6139e28ac6dc11c337b20b6ac9eb3d72dea94f5bc0ab6f3407d829fa`, `4dd58ce931ced6ce8e149d465ca58cd1cc245d2afbab0571159f47219c38f69a`, `6752b7e72c7bcc829bad311c56103d7951020a9a2d4261f753c045a451582318`.
- Normalized response capture SHA-256: `566f835fa65c13a918ecf6f8ffdf2ce955211f2afaa4689a8d39f722273fe93e`.
- Three fresh isolated `gpt-6.2-astra` defenders received one rendered prompt each. No source or scorer context; no GLM or Cloudflare calls.
- Score: **3/3 exact**, 3/3 parseable, 0 provider/transport failures. Actor progress was empty in both malicious cases: Astra revoked the correct session first. The approved DR case preserved both operators. V6 is rejected as easy without a larger grid.

The active-sabotage timing rule is meaningful and replay-backed, but a capable defender correctly prioritizes targeted containment. The next candidate adds an RPO choice among several producer-native locked points. A point can be unusable because of catalog/manifest or key lineage, while multiple usable points may remain. The task will require selecting the newest usable point, avoiding unnecessary data loss after containment.
