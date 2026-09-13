# Threat: encoded PowerShell command execution

Adversaries run PowerShell with a Base64-**encoded** command (the `-EncodedCommand` flag, or its
short forms `-enc` / `-ec`) to hide the script they execute from casual log review
(MITRE ATT&CK T1059.001). Your SOC ingests Windows **process-creation** events with these fields:
`host`, `user`, `parent`, `process`, `command_line`.

**One example** of the malicious activity (there are others — different hosts, users, and Base64
payloads):

```json
{
  "host": "WKS-14",
  "user": "alice",
  "parent": "winword.exe",
  "process": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  "command_line": "powershell.exe -NoProfile -EncodedCommand SQBFAFgAKABuAGUAdwAtAG8AYgBqAGUAYwB0ACAA"
}
```

**Your task:** write a **Sigma** detection rule (a `detection:` block with named selections and a
`condition`) that flags encoded-PowerShell executions **and does not fire on** legitimate PowerShell
use or on lookalike processes/arguments (e.g. an `encoder.exe`, a `--encode-check` flag). Your rule is
scored on a held-out corpus for both catch-rate (recall) and false-alarm rate (precision).

Reply with **only** the Sigma rule as YAML in a ```yaml code block.
