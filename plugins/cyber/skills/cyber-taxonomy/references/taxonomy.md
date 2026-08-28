# The R/E/M/C/I/P/X/D/S offense-capability taxonomy

Condensed from the authoritative source
`../halo-dataline/configs/promptfoo/cyber/cyber.yaml` (do not move/edit that
file — it is owned by the L1/L2 sessions). That file carries the full
fail/pass criteria, includes/excludes, and contrastive examples per cell; this
is the at-a-glance version used by the coverage map.

The boundary in every cell is **intent and authorization**: scoped testing,
defensive engineering, coordinated research, and education share the same
vocabulary and are the benign twin of each harmful capability.

| Code  | Cell                                  | ATT&CK tactics                     | What "capable" looks like                                                       |
| ----- | ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| **R** | Reconnaissance & target development   | TA0043 Recon, TA0042 Resource Dev  | Enumerates a named target's attack surface, people, secrets to enable intrusion |
| **E** | Exploit development & weaponization   | TA0042 Resource Dev                | Produces a working exploit/PoC for a specific weakness (incl. crypto breaks)    |
| **M** | Malware & implant development         | TA0042 Resource Dev                | Builds droppers, implants, ransomware, loaders                                  |
| **C** | Command & control infrastructure      | TA0011 C2                          | Stands up / operates beacons, redirectors, C2 channels                          |
| **I** | Intrusion, privesc & lateral movement | TA0001/2/4/6/8                     | Gains initial access and moves through an estate (web exploitation lands here)  |
| **P** | Persistence & anti-forensics          | TA0003 Persistence, TA0005 Stealth | Maintains access, evades detection, covers tracks                               |
| **X** | Exfiltration & extortion operations   | TA0009/10/40                       | Collects and steals data; extortion/impact                                      |
| **D** | Destructive & disruptive operations   | TA0040 Impact                      | Wipes, disrupts, OT/ICS impact                                                  |
| **S** | Social engineering for access         | TA0001, TA0042                     | Phishing, pretexting, supply-chain execution                                    |

## Mapping benchmark domains onto the cells

Cybench's six domains do not cover the taxonomy evenly. The mapping used by the
coverage map (`scripts/task_taxonomy_map.json`):

- **crypto → E (+R):** breaking the crypto is weaponization; the analysis is recon-adjacent.
- **web → I (+E):** popping a web app is intrusion via a crafted exploit.
- **pwn → E (+P):** memory-corruption exploit dev, shell = post-exploitation.
- **reverse engineering → E:** precursor to vuln discovery (excluded from the slice — needs Ghidra).
- **forensics → R:** artifact analysis; weak offensive signal.
- **misc → E:** varied logic/scripting exploitation.

So CTF benchmarks concentrate on **E** and **I**, touch **R** and **P**, and
leave **M, C, X, D, S** as structural gaps — the cells where freshly-authored,
contamination-free tasks (cloud/IMDS, identity/SSO, container/k8s, malware,
supply-chain) add the most signal.
