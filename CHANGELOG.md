# Changelog

This file records changes described by the project's public Git tags and GitHub release notes. Dates use the public release date.

## Unreleased

No changes recorded yet.

## 1.0.4 - 2026-10-08

### Fixed

- Automatically start enabled LibreHardwareMonitor sensors after administrator access is approved, including approval through the sidebar after a standard startup.
- Preserve the enabled sensor preference while administrator approval is pending or declined, without repeated automatic UAC prompts.
- Handle administrator approval arriving during an initial monitoring startup attempt without requiring an app restart or toggling sensors off and on.
- Keep waiting for administrator approval separate from sensor startup failures and automatic process recovery.

### Changed

- Show a localized waiting message and an administrator-access action in Overview when hardware sensors are enabled but administrator access is unavailable.
- Reuse the existing administrator broker and monitoring subscription flow; disabled sensors remain disabled and startup administrator approval remains opt-in.

### Validation and limitations

- Added regression coverage for deferred sensor activation, administrator approval, concurrent startup, disabled sensors, and genuine startup failures.
- The full local test suite passed: 285 tests passed and one skipped. Source linting, interface type checks, and the production frontend build passed.
- Real UAC approval and live hardware sensor readings still require manual verification on Windows.

## 1.0.3 - 2026-10-05

### Added

- Added Classic Context Menu, Clipboard Cloud Sync, SSD TRIM, and Windowed Game Optimizations tweaks with catalog-backed execution and status detection.
- Added an opt-in setting to request administrator access when the app starts; the default remains manual approval using the sidebar button for each app session.
- Added journaled Nova backup restoration with progress reporting, explicit continuation of interrupted restores, and validation against changed backups or tweak scripts.
- Added source linting, desktop interface type checks, and a packaged application smoke test to CI and Windows releases.

### Changed

- Split main-process IPC registration and renderer action hooks into focused modules while retaining the Electron and React architecture.
- Centralized tweak timeout validation and metadata normalization.
- Refined notification and backup restore presentation and improved responsive monitoring rows for multiple GPUs and network adapters.
- Updated development dependencies and generated release notes directly from the matching changelog version.

### Fixed

- Prevented background operations from initiating administrator approval before explicit session approval.
- Fixed the Classic Context Menu parameter contract and status output.
- Regenerated bundled tweak integrity metadata before local Electron startup so newly added tweak files are included.
- Removed an unsupported profile assignment from Clipboard Cloud Sync.
- Coordinated development process shutdown to avoid leaving a renderer running after Electron exits or fails.
- Blocked competing tweak execution during restoration and rejected restore continuation when execution fingerprints no longer match.

### Validation and limitations

- Automated source checks and Windows packaging smoke validation cover the release pipeline; real UAC, registry changes, and interrupted restoration still require the documented disposable Windows VM checks.
- Administrator detection is unchanged. An application explicitly launched with elevated Windows credentials remains elevated.
- The installer is unsigned; Windows can display an unknown-publisher warning.
- Performance-related tweaks depend on Windows version, hardware, and workload; no universal FPS improvement is claimed.

## 1.0.2 - 2026-09-20

### Fixed

- Fixed Game Mode deactivation status so an active preset immediately reports that it is being disabled.
- Restored the complete seven-action Game Mode activation sequence instead of skipping actions that were already active.
- Hardened Game Mode against concurrent execution and incomplete restore snapshots, with regression coverage for activation and deactivation.

[Release notes](https://github.com/NovaTweaksDev/Nova-Tweaks/releases/tag/v1.0.2)

## 1.0.2 Preview - 2026-09-20

### Added

- Added a persistent 30-day game-session history with saved performance reports.
- Expanded the known-game catalog and runtime monitoring details.

### Changed

- Refined the desktop interface, navigation, tweak cards, detail panels, notifications, and monitoring views.
- Improved Game Mode runtime tuning, session reports, memory insights, and processor-affinity feedback.
- Improved backup, overview, settings, and automation presentation while preserving their existing behavior.

### Fixed

- Fixed local administrator-broker identity forwarding for Game Mode runtime tuning.
- Fixed total system RAM reporting in completed game-session insights.
- Hardened memory-compression, page-combining, TCP auto-tuning, and NVIDIA display tweak execution.
- Improved bundled monitoring-sidecar integrity validation and hardware-monitor configuration.

[Release notes](https://github.com/NovaTweaksDev/Nova-Tweaks/releases/tag/preview-v1.0.2)

## 1.0.1 Preview - 2026-09-10

### Changed

- Removed the separate .NET 8 Desktop Runtime requirement for hardware monitoring.
- Kept tweak details visible while scrolling the tweak list.
- Localized release information and displayed the actual published GitHub release.
- Updated the Competitive NVIDIA profile preset.

### Fixed

- Fixed administrator approval and elevated worker communication.

[Release notes](https://github.com/NovaTweaksDev/Nova-Tweaks/releases/tag/preview-v1.0.1)

## 1.0.0 Preview - 2026-09-10

### Added

- Published the first public unsigned Windows preview for evaluation and compatibility testing.

The public release notes do not provide a more detailed change list for this version.

[Release notes](https://github.com/NovaTweaksDev/Nova-Tweaks/releases/tag/preview-v1.0.0)
