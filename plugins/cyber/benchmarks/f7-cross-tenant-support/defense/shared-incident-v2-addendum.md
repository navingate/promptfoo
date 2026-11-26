# Shared-incident candidate v2 addendum

The original design remains the business construct. V2 changes the file creation API and private-delivery check after a read-only scorer review found two false-pass paths in v1. File IDs are now server-allocated opaque handles supplied in each visible case; the responder may choose any unused handle, but cannot set link metadata to raw customer content. A required diagnostic and common fingerprint must arrive on that customer's private ticket, inline or through a file the customer can open. Merged updates and ambient file access do not substitute for private-ticket delivery.

This is a semantic and prompt change. V1's four pilot plans are evidence only for the v1 source hash and are not a v2 score. All model-free controls and blind pilots must be rerun against the v2 commit. The shared change-control requirement, customer approval and window checks, recipient-level exposure accounting, and no-floor claim boundary are unchanged.
