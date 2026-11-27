# F10 v23 response and shortcut analysis

The three frozen Astra responses are bytewise the same JSON actions as the
simple column-only procedure on their corresponding observations: hold a
pending stage whose column is `ssn`, and record a completed receipt whose
stage column is `ssn`. It scores 3/3 on the model-free G0 cases and 3/3 on
the pilot cases. The raw CLI JSONL has one completed final agent message per
session and no evidence-use reasoning trace. Thus the results show correct
visible **outcomes**, but cannot establish that Astra checked the job's
actor, publisher or recipient bindings. The identical actions are an
observation, not proof of the model's internal method.

The next bounded counterexample should keep the protected `ssn` stage,
publisher checkpoint, destination, cell scope, approved DOB ETL and native
sink lifecycle fixed while an authenticated job binding changes whether
that SSN stage is covered. In the covered twin, publishing SSN is a
sanctioned business export and a column-only hold wrongly prevents its
completed sink receipt. In the unbound twin, holding the same pending SSN
stage prevents unauthorized delivery. Both must complete DOB ETL. A
completed-receipt control should likewise record exposure only when the
SSN delivery lacked its own covering job. The producer must generate any
changed registry binding natively, and a separate visible-only audit must
score actual sink and log outcomes before a model call.

This is a proposed G0 direction, not a new fixture, score or floor claim.
