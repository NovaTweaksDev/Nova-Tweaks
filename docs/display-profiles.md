# Display profiles

Game Mode → Display profiles captures an already configured Windows/NVIDIA
setup. Configure the normal desktop outside Nova, save it as Desktop, then
configure the gaming setup and save it as Gaming. Nova does not invent stretch
resolutions or edit game configuration files.

## Behavior

- Up to 30 named profiles, including at most one desktop profile, are stored
  locally under `userData/display-profiles`.
- Gaming profiles may share a resolution and differ in Digital Vibrance.
  Opening capture refreshes the display readings, including outside changes.
- A confirmed session permits capturing another profile without replacing the
  recovery journal. Replacing the active profile requires ending the session
  first; Keep current state ends it without changing the display settings.
- Each card has a visible delete button with confirmation. Deleting a confirmed
  active profile does not change the display settings or discard its independent
  recovery snapshot. Deletion during its confirmation countdown is blocked.
- Resolution, exact refresh, output signal timing and readable NVIDIA scaling
  are captured together. Digital Vibrance is saved automatically when reliably
  readable, with no checkbox. Unavailable values remain unmanaged. Output color
  range is excluded from capture, activation, comparison and restoration.
  Legacy JSON and v1 native tokens are stripped of range data on load; affected
  profiles require another manual test before automation. Other settings remain.
- Every manual activation requires confirmation within 15 seconds. Native
  recovery is independent of the renderer and survives main-process termination.
  Windows resolution, refresh rate and output timing are saved to its display
  database on apply, so they survive reboot without Nova autostart. Rejecting or
  timing out a preview saves the previous mode again. Preflight stays read-only.
  Explicit recovery writes the return mode even if the live mode already matches,
  because the saved boot configuration may differ after a partial driver failure.
- Restore previous state returns to the configuration immediately before the
  session. Activate desktop profile applies the separately saved desktop setup.
- Switching profiles on the same monitor keeps the original return state.
  Legacy profiles without Digital Vibrance inherit its live value. Recapture
  such profiles to save a fixed vibrance value. Recovery retains the original
  captured vibrance across profile switches; no default value is invented.
  Saved vibrance requires a reliably restorable current value. Restore first
  when changing the target monitor.
- A gaming profile can be bound to the selected game executable. Automation is
  off by default and requires a confirmed manual test of that profile revision
  on the same monitor and driver. Select the gameplay executable, not its launcher.
- Process detection uses the existing watcher and works without FPS recording.
  Alt-Tab does not switch modes. A second game cannot displace the active profile.
  The watcher reads full executable paths and creation times with Windows limited
  process information, including games whose Get-Process.Path is unavailable.
  Empty executable paths never match an unassigned profile.
- A confirmed manual profile without a running assigned game permits automatic
  activation of a tested gaming profile on the same monitor. After game exit,
  Nova resumes the setup immediately before game start. This return setup is
  stored in the same journal; the original session recovery snapshot remains
  unchanged for explicit restoration and native recovery.
  Unconfirmed settings and external changes continue to block automation.
- Outside changes cause a recovery conflict rather than being overwritten.
  Explicit restoration and keeping the current state are separate actions.
- After an interrupted session, Nova retains the recovery journal. It does not
  blindly restore old hardware configurations after a reboot or driver change.
- Normal Nova shutdown keeps confirmed manual and automatic display settings.
  The process watcher stops first; Nova waits for the native guard to disarm
  before clearing an active journal and exiting. Unconfirmed settings still
  revert. Conflict/recovery journals remain for review, without changing the
  current display. Failed guard shutdown retains recovery. Game automation ends
  with Nova; closing the game later cannot trigger restoration while Nova is closed.

## Boundaries

Aspect-ratio scaling (NVAPI modes 5 and 6) is blocked for new activations,
including when the current return state uses it. A targeted native probe on
the DELL G2524H at 1798 × 1080 / 240 Hz reported success from the setter but
read back full-screen modes 2 and 1 instead of requested aspect modes 5 and 6.
Nova therefore cannot promise exact recovery for this setting. Set Full-screen
in NVIDIA Control Panel → Adjust desktop size and position, refresh Nova and
recapture the profile. Existing recovery journals remain available for recovery.
This restriction applies to the selected monitor, not other connected monitors.

The game selection button selects the gameplay executable shared with Game Mode;
it does not launch a game or enable automation. Assign that selection under
Manage profile and explicitly enable automatic switching after a confirmed test.

Profiles do not manage monitor topology, rotation, HDR, color depth, NVIDIA 3D
settings, audio, power settings or monitor OSD settings. Cloned displays are
not selectable. A saved custom resolution must still be offered by the driver.
Borderless stretch depends on the game's own rendering and aspect-ratio behavior.
Nova does not inject into games or guarantee true stretch for every title.

## Verification

Automated service tests cover fractional refresh rates, distinct desktop/signal
resolutions, original-state preservation, concurrency, partial failure, durable
recovery, deadlines, external conflicts, game identity and automation invalidation.
IPC tests reject foreign senders and subframes. The existing watcher is tested
with display-only demand and resource alerts disabled.

The opt-in native test in `electron/services/displayProfiles/displayProfileNative.test.js`
temporarily changes NVIDIA scaling under the recovery guard. Earlier checks on the local DELL G2524H / LG ULTRAGEAR setup verified scaling
and Digital Vibrance round trips, read-only preflight, the native timeout,
owner-process termination and unchanged settings on the second display.
For the range-removal revision, only the read-only native regression was rerun:
legacy range fields are cleared and vibrance merges without changing displays.
The full hardware switching sequence was not repeated.

The automation fix was checked against the running Fortnite client: its full
executable path and creation time are available through the revised watcher
without elevation, although Get-Process.Path and Win32_Process.ExecutablePath
were empty. Automated tests cover manual desktop → gaming → manual desktop,
watcher demand without recording, failed activation, and retained original recovery.
The live Fortnite display switch and exit sequence still need a manual pass.

The reboot-persistence revision rebuilds the native helper and tests rollback
when the live mode already matches but the saved boot mode does not. Applying
and restoring now use `SDC_SAVE_TO_DATABASE`; validation does not. An actual
Windows reboot with a confirmed profile has not been performed for this revision.

Before declaring broader compatibility, manually check:

1. Native desktop → an existing lower-resolution stretch mode → desktop,
   including fractional/high refresh values and Digital Vibrance.
2. A real borderless game using the chosen stretch profile, automatic launch/exit
   and restoration without enabling session recording.
3. Disconnecting the target monitor, reconnecting it, and recovery after reboot.
4. A system without NVIDIA and alternate driver versions.
5. External changes to each managed property during a session.

The graphical cards and capture dialog were inspected in a browser fixture with
real monitor readings. Full Electron UI-to-native interaction still needs a
manual pass; the fixture does not perform system changes.
