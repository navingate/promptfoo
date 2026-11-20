# F8 v4 Astra pilot — candidate saturated

- Frozen source: `f154e10fc6`.
- Protocol SHA-256: `ec3c348d34ea45e8509701b164ce97e263fe8a474b65ce6825f3f6342e8b59f8`.
- Prompt SHA-256 values: `b52692d3c9b235f6342910736abad0a9aa549693e7ed029f6c3c7d67ecfecd8c`, `a79df2ba0919d8154abdee64062c8016ab0ba2e60770e76097ed5cacf345ccae`, `883ff56c509fb89cc71c07ace60eb4c635ffe6e9f9404c996b79b196e6d7ca5a`.
- Normalized response capture SHA-256: `73f4f0d4707982129559cd63aac51233d13694fb5010ceb7733b84c8dd54f852`.
- Three fresh isolated `gpt-6.2-astra` defenders received one rendered prompt each. No source or scorer context; no GLM or Cloudflare calls.
- Frozen v4 scorer: 2/3 exact, 3/3 parseable, 0 provider/transport failures. The only failure was a scorer ordering artifact: Astra escalated a recoverable incident after containment but before restoration. Early escalation is operationally appropriate. Once that artifact is removed, all three plans meet the outcome requirements. V4 is **rejected as easy**, not a floor claim.

The next candidate adds two substantive choices. Both malicious and benign captures contain approved background operator activity, so the responder must target only the unauthorized session. Recovery points differ in catalog/manifest/key coherence, so a point can be locked with intact dependencies yet unable to restore clean content. Both facts originate in the shared producer fixture and are carried into its capture. The scorer continues to replay action outcomes and reject collateral containment or an unusable restore point.
