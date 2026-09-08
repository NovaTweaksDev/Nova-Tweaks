# Bundled PresentMon sidecars

Nova Tweaks bundles two pinned Intel/GameTechDev PresentMon releases for local
FPS and frametime capture:

- `PresentMon.exe`: version 2.5.1
- `PresentMonLegacy.exe`: version 1.10.0 compatibility fallback

Do not replace these files manually. Run `npm run vendor:presentmon` from the
repository root to download the official assets and verify their pinned
SHA-256 hashes. Version, origin, license, signature and hash details are kept in
`third-party-components.json` and `THIRD-PARTY-NOTICES.md` at the repository
root.

The Electron package copies this directory to
`process.resourcesPath/capture/PresentMon`, outside the application archive, so
the backend can launch the sidecars without a separate user installation.
