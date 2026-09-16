# Security Policy

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, or pull request.

Send the report to [info@nova-tweaks.com](mailto:info@nova-tweaks.com). This address is published on the official Nova Tweaks website. If GitHub Private Vulnerability Reporting is enabled for the repository, it may also be used.

Please allow time for the report to be reproduced and assessed before public disclosure. No fixed response or remediation time is promised.

## Useful report information

Include the information needed to reproduce and understand the issue:

- Affected Nova Tweaks version or commit
- Windows version, edition, and architecture
- Reproduction steps and required permissions
- Expected and actual behavior
- Relevant Nova Tweaks logs with secrets and personal data removed
- Screenshots with personal information redacted
- A minimal reproduction or proof of concept when practical
- Known impact and whether the behavior is repeatable

Do not send passwords, API keys, signing keys, private certificates, personal files, or unrelated user data.

## Scope

Security reports are particularly useful for issues involving:

- Privilege escalation or administrator broker boundaries
- PowerShell or command execution
- Unsafe file-system access or path handling
- Electron main, preload, renderer, protocol, and IPC boundaries
- Release and update metadata verification
- Tweak, helper, sidecar, or packaged artifact integrity
- Native Nova Tweaks helpers
- Unexpected or undisclosed network traffic
- Dependency vulnerabilities with a demonstrated Nova Tweaks impact

General bugs, unsupported hardware, feature requests, and expected Windows permission prompts belong in the normal issue templates.

## Supported versions

Security fixes target the current public release or preview and the current `main` branch. Older preview builds do not have a separate long-term support commitment. Reproduce the issue on the newest available public build when it is safe to do so, and always identify the exact affected version.
