# Security

Do not post secrets, customer Markdown or exploitable details in public issues.
Use this repository's private vulnerability reporting when enabled:
https://github.com/tegg-studio/tegg-markdown/security/advisories/new

If that feature is unavailable, request a private contact through the maintainer
profile without including vulnerability details. There is no guaranteed response
time or paid support implied by the free license.

Host applications remain responsible for authentication, authorization, resource
URL policy, persistence, CSP and revision conflict handling. Report sanitizer,
cross-instance state leakage or unsafe source-patch behavior with a minimal
sanitized reproduction and affected version.

## Handling process

Private vulnerability reporting is enabled for this repository (verified 2026-09-14).
Reports are triaged for affected versions, reachability, data exposure and available
mitigations. Confirmed issues receive a fix or documented mitigation, affected/fixed
version information and coordinated advisory disclosure. Use GitHub advisories for
CVE requests when applicable; not every report is a CVE. We do not promise a CVE
identifier, a universal patch deadline or a free response-time SLA. Contracted
support commitments must be agreed separately. Recheck channel availability as part
of release review; public Issues must not contain exploitable details.
