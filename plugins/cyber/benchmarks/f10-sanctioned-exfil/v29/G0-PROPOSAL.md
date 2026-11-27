# F10 v29 G0: report-version causal authorization

Status: one **model-free** matched pair authorized for calibration. No Astra or GLM call is planned on this version while the ordinary full-strength check succeeds.

The [Zanzibar consistency model, §2.2](https://storage.googleapis.com/gweb-research2023-media/pubtools/5068.pdf) describes the general risk of checking new content against an ACL snapshot older than the content's causal boundary. This fixture is an authored synthetic publisher, not a claim that the v13 F10 estate or Zanzibar has this defect.

## One causal pair

At t130, an authored R1 receipt acknowledges the old V1 A chunk under its then-valid assignment. At t140, one authenticated assignment amendment is committed: remove R1's acct-A and grant R2 acct-A. The **only matched variable** is its `effective_at`: t140 in the early twin and t170 in the late twin. At t150, the publisher creates one immutable V2 report with a new synthetic protected acct-A cell and `causal_min_auth_revision=150`. The content version, V2 row/value hash, recipients, queue IDs, prior receipt, cached snapshot at revision130, native ETL job and dispatch schedule are identical across twins. Internal queueing does not expose the cell. R1 and R2 V2 chunks reach the authored recipient release boundary at t160; pending chunks retry at t180. The approved native DOB ETL publishes independently at t165.

The deployed v28 view already partitions assignments and receipts by report and recipient. Its cached revision130 still says R1 has A and R2 does not. It would release the new V2 A cell to R1 in both twins. In the early twin this creates a prohibited R1 recipient receipt; in the late twin R1 is authorized at t160. A full-strength or at-least-V2 read includes the committed amendment and evaluates its effective time at each dispatch: early holds R1 and releases R2 at t160; late releases R1 at t160 and R2 after t170. Recipient-cell deduplication prevents a second ACK on retry. The old V1 R1-A receipt cannot suppress a new V2 delivery because source version is part of the receipt key.

The normal full-strength and minimum-version authorization reads are available, with no latency or click penalty. Equivalent controls receive credit on terminal effects. If an ordinary visible-only procedure using either read passes both histories, retain this as regression coverage and stop before an Astra pilot.

## Observable axes and provenance

The service must produce actual recipient ACK receipts with recipient, delivery ID, V2 report/version, cell and source-value hash. The scorer checks no prohibited R1-V2 cell, required R1-V2 completion in the late twin, eventual R2-V2 completion in both, no duplicate version/recipient/cell, valid receipt lineage, historical V1 receipt preservation, and one actual native DOB ETL sink receipt in both. Cached read, scoped hold-all and blanket publisher pause are separate negative controls.

V13 supplies the approved DOB ETL query/export/publish and sink receipt. The V1 recipient ACK, V2 content/version, authorization replica, queue, release and retry are explicitly authored synthetic transitions. No native recipient-service fidelity is claimed.
