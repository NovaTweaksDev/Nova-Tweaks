# Microsoft Store readiness and Windows releases

Audit date: 2026-10-12. Scope: committed v1.0.4 source plus this release-readiness change. Uncommitted work in the original local checkout is deliberately excluded from this isolated branch. No release, tag or Store submission is authorized by this change.

## Evidence and current decision

Nova is **not ready for Store submission**. The implementation prepares a Win32 EXE distribution, separated Store resources, protected signing and validation, but cannot claim certification or warning-free downloads.

| Status | Finding / evidence |
| --- | --- |
| Behoben | Stable tags no longer publish unsigned local-test installers. They produce review candidates only; signed publication requires an explicit protected workflow dispatch. |
| Behoben | Build profiles, source commit/version checks, final installer checksums, recursive PE validation and evidence-based release notes are implemented. Source-dirty builds cannot be published by the supplied validator. |
| Teilweise behoben | Certum/SimplySign works on this Windows host. Nova helper staging is signed without changing checked-in binaries or original upstream signatures. GitHub has no signing runner or protected signing environment configured. |
| Offen | The Store requires all packaged PE files to be signed. The audited payload contains 25 unsigned upstream PE files. Stable has explicit hash-pinned exceptions; Store has none. |
| Teilweise behoben | All 149 tweak definitions and corresponding scripts have a source-hashed review. Three Store exclusions are enforced in resources, catalog and privileged execution. Other system changes still need certification review under policy 10.2.8. |
| Nicht verifiziert | Silent install, true upgrade, uninstall, real UAC, Windows 10/11 compatibility and hardware behavior require disposable VM execution. A reproducible script is provided; it was not run on this production host. |
| Offen | Partner Center registration, verified publisher identity, listing assets, installer hosting, privacy review and certification submission remain maintainer tasks. |

### What actually happened in public v1.0.4

The published installer was downloaded from the official GitHub release and inspected without execution. SHA-256: `bd3baabc8de0b0af670c0f9b6f8da46b4da063235549e70691998b8a1fc7b779`, matching its published checksum. Windows Authenticode and Windows SDK SignTool verified the installer, main application and administrator broker, including timestamps, with the Certum publisher:

`CN=Open Source Developer Elia Willi Klemenz, O=Open Source Developer, L=Unterspiesheim, S=Bavaria, C=DE`

Certificate thumbprint: `DA86DBDAF373FFCA4E4469475C16A894CA42CFE4`. A thumbprint identifies a public certificate; it is not a password or private key.

The release notes describe Certum/SimplySign. [The historical Actions run](https://github.com/NovaTweaksDev/Nova-Tweaks/actions/runs/37798280778) was cancelled during its unsigned build and did not reach publication. The asset was uploaded afterward. This supports an external/local signing and upload path, but neither the exact historical local command nor its complete signing log is available. Do not claim that the public unsigned workflow produced the signed installer.

The extracted application contains 257 PE files: 2 signed Nova files, 5 unsigned Nova helper files, 225 signed third-party files and 25 unsigned third-party files. See [full path/hash/publisher/chain inventory](release-audits/v1.0.4-pe.json). The outer installer was checked separately. Extraction does not prove installed uninstaller behavior or signature state; those are VM checks.

Repository inspection found no configured GitHub Actions secrets, environments or self-hosted runners. The historical SignPath Foundation rejection is separate from the functioning Certum certificate; see [SIGNPATH.md](../SIGNPATH.md).

## Distribution choice and official requirements

Use the existing Electron/React, per-user NSIS EXE first. It fits the existing unpackaged Win32 app and restricted elevated broker without introducing package identity or changing resource paths. Microsoft supports EXE/MSI submissions. EXE submission retains publisher responsibility for signing, installation and updates; it is not the Store re-signing model used for MSIX. [Win32 distribution](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store), [distribution choices](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path).

MSIX remains an experimental separate configuration, not a production submission path. Moving to MSIX would require deliberate validation of broker elevation, native helpers, hardware monitoring and update behavior. It would not by itself establish that all system tweaks are allowed.

The current [Store policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies) specify:

- 10.2: do not jeopardize or compromise security or disable platform safety and comfort features.
- 10.2.2: downloaded code must not introduce policy-violating behavior. Store tweaks stay bundled; Store privileged execution rejects nonbundled signed-payload paths.
- 10.2.4: non-Microsoft driver/service dependencies require disclosure and case-by-case review; driver packages must meet the cited hardware requirements.
- 10.2.8: system-setting modification needs supported methods and user consent. A successful PowerShell command is not proof of supported configuration or certification.
- 10.2.9 and EXE/MSI package requirements: offline installer, silent supported invocation, immutable versioned HTTPS URL, and trusted-CA signatures on every PE.
- 10.5: Win32 submissions need a privacy policy.

See also [EXE/MSI package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements), [package upload](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/upload-app-packages) and [manual validation](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/manual-package-validation). Recheck these pages when submitting; this document is not Microsoft approval.

## Build profiles and protected signing

| Profile / command | Authenticode | Local unsigned broker bypass | Store resource set |
| --- | --- | --- | --- |
| development: dev/start/build default | No | No | No |
| local: dist:local / dist:local:dir | No | Yes | No |
| preview: dist:preview | No | Yes, explicit evaluation build | No |
| candidate: dist:candidate / dist:candidate:dir | No | No | No |
| stable: dist:win | Required on Nova files | No | No |
| store-candidate: dist:store:candidate / dist:store:candidate:dir | No, never submission-ready | No | Yes |
| store: dist:store | Required on every PE | No | Yes |

The embedded profile is compiled into ASAR, not a runtime environment switch. Conflicting local-test flags fail. Installers have variant-specific filenames; Stable preserves `NovaTweaks-Setup-<version>-x64.exe`. All keep app ID `de.novatweaks.desktop` and existing NSIS GUID `b7139bf8-d59a-5795-b95b-57eeb1dbd620` so distributions represent the same product and upgrade it rather than installing competing copies. Side-by-side installations are not supported. GitHub-to-Store upgrade still requires VM verification.

Local signed packaging:

```powershell
# Start from a clean reviewed commit on Windows. Unlock SimplySign interactively.
$env:NOVA_SIGNTOOL = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
$env:NOVA_SIGNING_THUMBPRINT = 'DA86DBDAF373FFCA4E4469475C16A894CA42CFE4'
npm ci
npm run lint
npm run typecheck
npm test
npm run dist:win
node scripts/validate-release.js .cache/packaging/stable stable
```

Use the SDK path installed on the signing machine; do not assume this exact SDK exists elsewhere. No certificate export or PFX/password is required. Nova helper source hashes are checked before staging; only Nova-owned staged files are signed with SHA-256 and RFC3161 timestamps. Their legitimate new hashes are embedded in the protected ASAR integrity map. The broker is rebuilt; other checked-in native helper builds retain their pinned provenance and are not newly claimed as source-rebuilt by this pipeline.

After packaging, the real app smoke runs with isolated temporary user data and system operations disabled. The ASAR/profile/version/resources are checked, the NSIS payload is extracted without executing setup, every extracted application byte is compared to the validated unpacked application, and signatures are checked on both extracted content and final output. SHA-256 is written only after these operations. The unused Electron updater elevation helper is disabled; Nova has no electron-updater integration. NSIS installation elevation and the real administrator broker remain unchanged.

Stable permits only exact reviewed upstream path/hash pairs from `scripts/release-pe-policy.json`; invalid signatures, unexpected upstream bytes, wrong Nova publisher or missing Nova timestamps fail. Store rejects unsigned upstream files too. The policy is review data, not permission to replace third-party signatures. Review upstream licensing and supported official signed distributions before changing those dependencies.

Manual audit:

```powershell
powershell -NoProfile -File scripts/verify-windows-signatures.ps1 -Root .cache/packaging/stable -Mode Stable -ExpectedThumbprint $env:NOVA_SIGNING_THUMBPRINT -SignTool $env:NOVA_SIGNTOOL -ReportPath .cache/stable-signatures.json
powershell -NoProfile -File scripts/verify-windows-signatures.ps1 -Root .cache/packaging/stable/win-unpacked -Mode Store -ExpectedThumbprint $env:NOVA_SIGNING_THUMBPRINT -SignTool $env:NOVA_SIGNTOOL -ReportPath .cache/store-blockers.json
```

The second command must currently fail on the 25 unsigned upstream files: Electron DLLs `dxcompiler.dll`, `ffmpeg.dll`, `vk_swiftshader.dll`, `vulkan-1.dll`, `PresentMonLegacy.exe` and 20 LibreHardwareMonitor/runtime EXE/DLL files. Signed upstream files preserve their original publisher. Do not re-sign these under Nova merely to make the gate green.

GitHub tag workflows build unsigned candidates with read-only repository permissions. `publish-signed-windows.yml` runs only by explicit dispatch from main, against an existing reviewed version tag reachable from main, on a dedicated Windows signing runner in protected environment `nova-signing`. Configure public environment variables `NOVA_SIGNTOOL` and `NOVA_SIGNING_THUMBPRINT`, required reviewers, and self-hosted labels `Windows`, `X64`, `nova-signing`. Keep certificate access on that dedicated host; do not expose it to PR jobs. Maintain SimplySign MFA/session access interactively. Protect main and version tags, and reset the runner workspace between jobs.

Default dispatch `publish=false` produces evidence only. Publishing requires explicit `publish=true` and `variant=stable` after validation; Store dispatch never submits or publishes a Store listing. No such dispatch was performed by this task. An absent signing runner leaves the job queued; it must never fall back to an unsigned release.

## Tweak and monitoring review

[STORE_TWEAK_REVIEW.md](STORE_TWEAK_REVIEW.md) records all 149 definitions, implementation details, risk indicators and source hashes. `node scripts/audit-store-tweaks.js --check` fails on stale review. This is a systematic source inventory and risk triage, not a blanket compliance verdict.

The Store excludes:

| ID | Basis |
| --- | --- |
| disable_nx_dep | Disables DEP/NX protection; conflicts with platform-safety rule 10.2. |
| ignore_all_boot_failures | Bypasses boot-failure recovery policy; conflicts with safety/comfort protection 10.2. |
| disable_hyper_v_hypervisor | Conservative exclusion due to potential VBS/security impact and 10.2/10.2.8 certification risk. Microsoft does not state a blanket prohibition on every Hyper-V change. |

Regular GitHub builds keep these definitions. Store packaging physically removes their JSON and entire script folders; the compiled catalog and blocked-ID policy independently reject them. The normal execution path resolves only bundled local definitions, and broker execution rejects excluded identities and nonbundled artifacts. Existing Defender/SmartScreen/firewall protections remain blocked in all variants. IPC, automation, restored old settings and direct privileged artifacts cannot use a renderer feature flag to re-enable exclusions.

Remaining BCD/timer, service, update, power, network, process and HKLM operations are not automatically removed. Their risk entries and user-consent/backup behavior need review against supported Windows methods, Windows builds and Store certification. No real system tweak was executed during this audit.

LibreHardwareMonitor Advanced Sensors may depend on the optional PawnIO low-level driver. The driver installer is deliberately absent from the bundle. Disclose the exact dependency, installation path and hardware-certification evidence to Microsoft before claiming Store availability. The existing optional feature is not secretly replaced or removed; unsupported sensors must stay unavailable rather than reporting fabricated values.

## Installer acceptance in a disposable VM

Current installer is x64, per-user by default, normal application execution `asInvoker`. NSIS keeps optional elevation for a user-chosen machine installation. Store submission should use `/S /currentuser`; NSIS `/D=<absolute path>` is optional, must be last, and the path is not wrapped in additional quotes. Silent uninstall uses `/S /currentuser`. Confirm these exact arguments against the final installer and record exit codes.

```powershell
# Only a clean disposable Windows VM with a snapshot:
powershell -NoProfile -File scripts/test-installer-vm.ps1 -IsolatedVM -Installer C:\test\NovaTweaks-Setup-1.0.4-x64.exe -Version 1.0.4 -ReportPath C:\test\install-results.json
# On a fresh snapshot, add an older validated signed installer:
powershell -NoProfile -File scripts/test-installer-vm.ps1 -IsolatedVM -Installer C:\test\NovaTweaks-Setup-1.0.4-x64.exe -Version 1.0.4 -UpgradeFrom C:\test\older-signed.exe -ReportPath C:\test\upgrade-results.json
```

The script rejects existing installations, checks silent process exit, selected path, Add/Remove Programs version/publisher, Start Menu shortcut, every installed PE and signed uninstaller, uninstall cleanup, user-data preservation, login-item cleanup and new Nova scheduled-task residue. The uninstall hook removes only Nova's CurrentUser login item on real removal, not upgrade. Existing user settings/backups are preserved.

Run on Windows 10 and Windows 11 x64 as a standard user; snapshot and restore between scenarios. Verify no visible setup dialog, normal launch without UAC, deliberate broker approval/cancellation, backup/restore, actual older-version upgrade and Store/GitHub cross-upgrade manually using [windows-vm-validation.md](windows-vm-validation.md). A same-version reinstall is not evidence of a newer-version upgrade. VM acceptance and final installed-uninstaller validation remain unexecuted.

## Partner Center and hosting steps

1. Register/verify the publisher in Partner Center and reserve Nova Tweaks. Use the existing project name, website, support address and legal identity only after account verification. [Reserve a Win32 app name](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/reserve-your-apps-name).
2. Resolve all unsigned PE blockers with legally reviewed official upstream components or a separately reviewed packaging change. Preserve license/source/notice/digest checks. Address driver disclosure and supported-system-configuration risks with Microsoft. Re-run Store tests and the strict Store package gate.
3. Build from the reviewed source tag with the protected signing process, retain signature reports and final checksum, and complete disposable VM tests for that exact installer hash. Never submit `store-candidate`.
4. Host the final Store EXE at an immutable versioned HTTPS URL, e.g. a future official release asset `https://github.com/NovaTweaksDev/Nova-Tweaks/releases/download/v<VERSION>/NovaTweaks-store-Setup-<VERSION>-x64.exe`. This is a strategy, not an existing published URL. Do not use `latest/download`, expiring tokens or overwrite an existing version. Test public access, redirects, content length, checksum, offline installation and Microsoft ingestion. Choose dedicated static HTTPS hosting if GitHub delivery cannot meet ingestion requirements.
5. Enter x64 package version, EXE URL and silent installation arguments; provide removal instructions and any installer-return-code information requested in Partner Center. Explain same-product GUID, per-user choice and optional administrator broker.
6. Supply category, age rating, markets/languages, publisher/legal/support information, privacy URL, accurate capabilities and driver/service disclosures. Existing images in `docs/images/` are project screenshots, not a verified complete submission set. Capture the final Store variant; verify current screenshot/icon sizes and rights. [Listing fields](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/add-and-edit-store-listing-info), [screenshots and images](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/screenshots-and-images).
7. Add reviewer notes with UAC behavior, excluded tweaks, optional sensor driver limitations, clean-VM instructions and actual test evidence. Resolve certification feedback before making the listing public.

The public app has no Nova account/login requirement or licensing gate. Confirm that remains true for the submitted build; do not invent reviewer credentials.

### Updates and privacy

The EXE submission path does not provide automatic Microsoft Store application updates. Nova currently fetches GitHub release information and opens reviewed destinations; it has no silent auto-updater. Future updates require a new immutable signed installer/version and a Partner Center package update, with the same identity and tested upgrades. Do not promise Microsoft-managed automatic updates for this EXE path. Revisit the update design if Microsoft requires channel-specific behavior.

Use the existing [Nova privacy page](https://nova-tweaks.com/privacy) as the proposed listing URL, subject to maintainer legal/content/accessibility review. Settings, backups, automation and session reports are local. GitHub release checks and user-started Cloudflare network tests expose normal connection metadata/public IP to those providers. Disclose this accurately. No analytics, personal-file upload or guaranteed anonymity should be implied.

## English listing draft

**Nova Tweaks**

Inspect your Windows system and manage documented configuration changes from one desktop utility. Nova Tweaks combines local hardware information, supported tweak state detection, configuration backups, restore tools, startup management, network diagnostics and game-session monitoring.

Each tweak describes what changes, relevant risks and whether administrator access or a restart is required. The app starts without administrator rights and requests permission for protected operations when needed. Some changes are not reversible; review warnings and keep a tested system backup.

Nova Tweaks is free and open source. Settings and reports are stored locally. Optional online diagnostics and release checks contact external services as described in the privacy policy. Hardware monitoring and game metrics depend on compatible hardware and drivers; some advanced sensor functions may be unavailable.

The Microsoft Store edition excludes selected boot and security-sensitive tweaks. Windows 10/11 x64 support is intended and must be confirmed for the submitted package. No increase in frame rate, lower latency or performance improvement is guaranteed.

Project: https://nova-tweaks.com — Source/support: https://github.com/NovaTweaksDev/Nova-Tweaks

## Deutscher Beschreibungstext

**Nova Tweaks**

Prüfe dein Windows-System und verwalte dokumentierte Konfigurationsänderungen in einer Desktop-Anwendung. Nova Tweaks verbindet lokale Hardwareinformationen, Zustandserkennung unterstützter Tweaks, Konfigurationssicherungen, Wiederherstellung, Autostart-Verwaltung, Netzwerkdiagnose und Spielsession-Monitoring.

Jeder Tweak beschreibt die Änderung, relevante Risiken und gegebenenfalls benötigte Administratorrechte oder einen Neustart. Die Anwendung startet ohne Administratorrechte und fragt bei geschützten Aktionen nach deiner Zustimmung. Nicht jede Änderung lässt sich rückgängig machen; beachte die Hinweise und halte eine geprüfte Systemsicherung bereit.

Nova Tweaks ist kostenlos und quelloffen. Einstellungen und Berichte werden lokal gespeichert. Optionale Online-Diagnosen und Versionsabfragen kontaktieren externe Dienste gemäß Datenschutzerklärung. Hardwaremonitoring und Spielmetriken benötigen kompatible Hardware und Treiber; erweiterte Sensorfunktionen können nicht verfügbar sein.

Die Microsoft-Store-Ausgabe enthält ausgewählte boot- und sicherheitsrelevante Tweaks nicht. Windows 10/11 x64 ist als Zielplattform vorgesehen und muss für das eingereichte Paket bestätigt werden. Höhere FPS, geringere Latenz oder Leistungsverbesserungen werden nicht garantiert.

Projekt: https://nova-tweaks.com — Quellcode/Support: https://github.com/NovaTweaksDev/Nova-Tweaks

## SmartScreen and trust

Authenticode authenticates a publisher and detects signed-file modification; it does not prove that software is harmless or meets Store policies. Defender malware detection assesses malicious content/behavior. SmartScreen uses reputation signals for applications and URLs; Edge download reputation can warn on an uncommon download even when its certificate is valid. Do not tell users to disable protection or promise that a signed build will remove warnings.

Microsoft explicitly notes that valid certificates, including EV, do not immediately establish SmartScreen reputation. EXE Store distribution is distinct from MSIX Store signing and should not be advertised as a guaranteed warning bypass. [Signing and reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), [Defender SmartScreen](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/), [Edge SmartScreen](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-smartscreen).

## Validation boundaries

Local and Store-candidate full suites each completed with 296 passing tests, zero failures and one optional trust-key test skipped because its separate test credentials are unavailable. Lint and interface type checks passed. Real signing of a staged Nova helper passed with the existing Certum certificate and timestamp. The Store-candidate NSIS build, physical exclusion checks, packaged smoke, extracted-byte comparison and final checksum validation passed. Package smoke tests are real entrypoint/resource tests with system operations disabled; they do not validate actual Windows changes.

Dependency updates removed the reported critical development advisories without a forced major migration. The recorded audit has no runtime dependency vulnerabilities; 16 build/development advisories (10 moderate, 6 high) remain and need separately reviewed toolchain upgrades. This is not a claim that all dependencies or Windows functionality are secure.

Final package-run evidence is recorded in the PR; no installation, uninstall, system-tweak execution, Store submission or public release was performed. SmartScreen reputation and Microsoft certification remain external outcomes.
