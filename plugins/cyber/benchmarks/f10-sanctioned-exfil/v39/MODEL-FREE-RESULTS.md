# F10 v39 revoked remote release: model-free G0

Source commit `4dcc758349`; manifest SHA-256
`727eabbadef2cf46052957f1042c0810e8abc4edb2a708be12fa62d24b69a36e`;
screen SHA-256
`4371d00291f60dce571c18c10a1048bcd0256e371e8f0020d59ab94b017141e7`.
The manifest replay and five focused tests pass. No Astra or GLM call has
been made on v39; no defensive floor claim follows from this screen.

The t80 approved request, authenticated revocation effective t95,
ambiguous t90 no-ACK attempt, t110 responder, source stage, job, recipient,
local queued status and independent approved DOB ETL are identical. The
sole matched service outcome is whether the separate recipient process
durably accepted A at t90. The prelookup observation does not name that
outcome; normal authenticated recipient lookup returns either the actual
service receipt with `accepted_at:90` or an empty ledger. Native v13 via
v34 supplies source-stage/ETL lineage and denied full-stage retry. The
recipient process, time-stamped receipt, approval gate and local admission
worker are a new explicitly authored composition, not native v13 behavior.

| Worker action                                              | Prior accepted t90                                      | No prior acceptance                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Published v38 submitted repair                             | Pass: one old receipt, local A completed against its ID | **Fail:** new recipient receipt accepted t110 after revocation, local A completed |
| Independently written ordinary authority + recipient audit | Pass: historical receipt retained and A completed       | Pass: no recipient copy, A durably revoked                                        |
| Static hold                                                | Fail: falsely revokes already delivered A               | Pass                                                                              |
| Static complete                                            | Fail: no actual receipt-ID binding                      | Fail: falsely completes undelivered A                                             |
| No action                                                  | Fail: A remains queued                                  | Fail: A remains queued                                                            |

The pre-cutoff receipt is
`recipient-rcpt-7b9ba7d54dd7edc18c3b` at t90. In the no-receipt arm, the
unchanged v38 worker's actual prohibited t110 receipt is
`recipient-rcpt-83db22acffec35987842`. The ordinary reference reads only
the trusted authority record and normal recipient ledger, never the private
arm selector. It completes A against the old receipt in one arm and marks
the undelivered A revoked in the other. The separate native DOB ETL receipt
`rcpt-fb8252f803f7eb3e74` is present in every replay, with full source
retry denied. Terminal scoring separately checks new prohibited acceptance,
old receipt preservation, local obligation truth, source/recipient lineage
and native ETL continuity.

This is a causal counterexample to applying the published v38 repair
unchanged after an authenticated revocation. It also has a straightforward
visible ordinary repair. The screen supports independent G0 review, not a
prediction that Astra will fail. Any pilot would require its own frozen
interface and review; if the ordinary receipt/authority audit makes the
task a solved fixed procedure, retain v39 as regression coverage.
