# Changelog

This file records changes described by the project's public Git tags and GitHub release notes. Dates use the public release date.

## Unreleased

No release notes have been published for changes after `v1.0.2`.

## 1.0.2 - 2026-09-20

### Fixed

- Fixed Game Mode deactivation status so an active preset immediately reports that it is being disabled.
- Restored the complete seven-action Game Mode activation sequence instead of skipping actions that were already active.
- Hardened Game Mode against concurrent execution and incomplete restore snapshots, with regression coverage for activation and deactivation.

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
