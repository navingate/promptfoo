# Incident triage — synthetic artifacts

You are triaging a suspected intrusion. Below are the collected artifacts. Read them, form a
coherent incident hypothesis, and answer the questions.

## Process-creation events

| time  | host    | user  | parent         | process         | command_line                                                               |
| ----- | ------- | ----- | -------------- | --------------- | -------------------------------------------------------------------------- |
| 09:14 | WKS-14  | alice | outlook.exe    | winword.exe     | "winword.exe /n C:\\Users\\alice\\Downloads\\Invoice_Q3.docm"              |
| 09:14 | WKS-14  | alice | winword.exe    | powershell.exe  | "powershell.exe -NoProfile -EncodedCommand SQBFAFgA..."                    |
| 09:15 | WKS-14  | alice | powershell.exe | schtasks.exe    | "schtasks /create /tn UpdateHealth /tr C:\\ProgramData\\u.ps1 /sc onlogon" |
| 09:41 | SRV-DB1 | alice | services.exe   | wsmprovhost.exe | "wsmprovhost.exe (WinRM remote session)"                                   |

## Authentication events

| time  | account | from   | to       | type            | result  |
| ----- | ------- | ------ | -------- | --------------- | ------- |
| 08:02 | alice   | WKS-14 | WKS-14   | interactive     | success |
| 09:41 | alice   | WKS-14 | SRV-DB1  | network (WinRM) | success |
| 09:44 | alice   | WKS-14 | SRV-APP2 | network         | failed  |

## Notes

- `Invoice_Q3.docm` was delivered as an email attachment to alice at 09:12.
- No other host shows an initial macro/office → script execution.

## Questions — answer with a single JSON object

Fields and their allowed values:

- `patient_zero_host`: one of `WKS-14`, `SRV-DB1`, `SRV-APP2`
- `initial_access`: one of `phishing_document`, `exposed_rdp`, `sql_injection`, `supply_chain`
- `compromised_account`: one of `alice`, `svc_sql`, `deploy`
- `persistence`: one of `scheduled_task`, `registry_run_key`, `service`, `none`
- `containment`: an object with `isolate_hosts` (list of hosts) and `disable_accounts` (list of accounts)

Your `containment` must be **consistent** with your own findings: isolate the host you identify as
patient zero and disable the account you identify as compromised.

Reply with **only** the JSON object.
