# Support and compatibility policy

This is a developer preview. Pin a reviewed preview and upgrade to the latest preview
for fixes; no long-term preview branch or response-time SLA is promised.

After non-preview releases exist, the current minor line receives ordinary fixes.
The previous minor receives best-effort critical security/data-loss backports for
90 days after the replacement release; its release notes will record actual dates.
Within a minor, patch releases avoid breaking API, CSS-token and default-behavior
changes. Breaking changes move to a new minor before 1.0, and a major from 1.0.
Except urgent security fixes, stable API removal receives at least two minor releases
and 90 days of deprecation notice. Security changes explain migration explicitly.

Use GitHub Issues for reproducible bugs and compatibility gaps. Public issue reports
should include version/profile/browser, expected/actual behavior and a minimal
sanitized example if needed to explain the bug. Partner-specific corpora or business
access are not prerequisites: the project maintains standard and generic fixtures.
Do not post sensitive documents or exploitable details; follow [SECURITY.md](SECURITY.md).

Paid support, longer maintenance and white-label rights require a separate written
agreement. Free commercial use under the existing attribution license remains available.
