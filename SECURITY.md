# Security policy

Please do not report security issues in public issues.

Send a private report to the Signalflare maintainers with:

- the affected version or commit;
- reproduction steps;
- potential impact;
- any suggested remediation.

The compiler must never embed credentials in generated output or print authorization headers, API keys, cookies, or secrets in diagnostics. Reports involving accidental secret disclosure should be treated as urgent and the exposed credential should be rotated immediately.
