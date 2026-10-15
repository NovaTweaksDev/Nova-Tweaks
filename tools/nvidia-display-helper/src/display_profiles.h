#pragma once

// Minimal display ABI declarations from NVIDIA's public NVAPI SDK (MIT).
// https://github.com/NVIDIA/nvapi/blob/main/nvapi.h
// Keep these layouts in sync with the versioned public structures.
// Copyright (c) 2019-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
struct ProfileNvTimingExt { NvU32 flag; NvU16 rr; NvU32 rrx1k, aspect; NvU16 rep; NvU32 status; NvU8 name[40]; };
struct ProfileNvTiming {
  NvU16 hv, hb, hfp, hsw, ht; NvU8 hp;
  NvU16 vv, vb, vfp, vsw, vt; NvU8 vp;
  NvU16 interlaced; NvU32 pclk; ProfileNvTimingExt etc;
};
struct ProfileNvDetails {
  NvU32 version; NvS32 rotation, scaling; NvU32 refreshRate1K, flags;
  NvS32 connector, tvFormat, timingOverride; ProfileNvTiming timing;
};
struct ProfileNvSource { NvU32 width, height, depth; NvS32 format, x, y, spanning; NvU32 flags; };
struct ProfileNvTarget { NvU32 displayId; ProfileNvDetails* details; NvU32 targetId; };
struct ProfileNvPath {
  NvU32 version, sourceId, targetInfoCount; ProfileNvTarget* targetInfo;
  ProfileNvSource* sourceModeInfo; NvU32 flags; void* adapterId;
};
static_assert(sizeof(ProfileNvTiming) == 96, "NVAPI timing ABI mismatch");
static_assert(sizeof(ProfileNvDetails) == 128, "NVAPI display ABI mismatch");
using ProfileNvGet = NvAPI_Status(__cdecl*)(NvU32*, ProfileNvPath*);
using ProfileNvSet = NvAPI_Status(__cdecl*)(NvU32, ProfileNvPath*, NvU32);
using ProfileNvDisplayId = NvAPI_Status(__cdecl*)(const char*, NvU32*);
using ProfileNvDriver = NvAPI_Status(__cdecl*)(NvU32*, NvAPI_ShortString);

std::string ProfileUtf8(const wchar_t* value) {
  int length = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (length <= 0) throw std::runtime_error("Invalid display identity.");
  std::string result(static_cast<size_t>(length), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), length, nullptr, nullptr);
  result.pop_back(); return result;
}
std::string ProfileHex(const void* data, size_t size) {
  static const char* digits = "0123456789abcdef";
  const auto* bytes = static_cast<const unsigned char*>(data);
  std::string result; result.reserve(size * 2);
  for (size_t i = 0; i < size; ++i) { result += digits[bytes[i] >> 4]; result += digits[bytes[i] & 15]; }
  return result;
}
std::vector<unsigned char> ProfileUnhex(const std::string& text) {
  if (text.empty() || text.size() % 2 || text.size() > 16384) throw std::runtime_error("Invalid snapshot encoding.");
  std::vector<unsigned char> result(text.size() / 2);
  auto digit = [](char c) -> int { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; throw std::runtime_error("Invalid snapshot encoding."); };
  for (size_t i = 0; i < result.size(); ++i) result[i] = static_cast<unsigned char>((digit(text[i * 2]) << 4) | digit(text[i * 2 + 1]));
  return result;
}
struct ProfileSnapshot {
  NvU32 magic = 0x4e445031, size = sizeof(ProfileSnapshot);
  DISPLAYCONFIG_SOURCE_MODE source{};
  DISPLAYCONFIG_TARGET_MODE target{};
  DISPLAYCONFIG_RATIONAL refresh{};
  DISPLAYCONFIG_SCALING scaling{};
  DISPLAYCONFIG_SCANLINE_ORDERING scanline{};
  NvS32 nvScaling = -1;
  NvU32 nvRefresh = 0, includeVibrance = 0, includeRange = 0;
  NV_DISPLAY_DVC_INFO_EX vibrance{};
  NV_COLOR_DATA_V5 color{};
};
static_assert(offsetof(ProfileSnapshot, nvScaling) == 96, "Display snapshot v1 layout changed");
static_assert(offsetof(ProfileSnapshot, vibrance) == 112 && offsetof(ProfileSnapshot, color) == 132, "Display color snapshot v1 layout changed");
struct ProfileTopology {
  std::vector<DISPLAYCONFIG_PATH_INFO> paths;
  std::vector<DISPLAYCONFIG_MODE_INFO> modes;
  ProfileTopology() {
    for (int attempt = 0; attempt < 4; ++attempt) {
      UINT32 pc = 0, mc = 0;
      LONG status = GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pc, &mc);
      if (status != ERROR_SUCCESS) throw std::runtime_error("Cannot enumerate active displays.");
      paths.resize(pc); modes.resize(mc);
      status = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pc, paths.data(), &mc, modes.data(), nullptr);
      if (status == ERROR_INSUFFICIENT_BUFFER) continue;
      if (status != ERROR_SUCCESS) throw std::runtime_error("Cannot read display configuration.");
      paths.resize(pc); modes.resize(mc); return;
    }
    throw std::runtime_error("Display configuration changed during discovery.");
  }
  DISPLAYCONFIG_TARGET_DEVICE_NAME Name(size_t index) const {
    DISPLAYCONFIG_TARGET_DEVICE_NAME name{};
    name.header = { DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME, sizeof(name), paths[index].targetInfo.adapterId, paths[index].targetInfo.id };
    if (DisplayConfigGetDeviceInfo(&name.header) != ERROR_SUCCESS) throw std::runtime_error("Cannot identify display.");
    return name;
  }
  std::string Gdi(size_t index) const {
    DISPLAYCONFIG_SOURCE_DEVICE_NAME name{};
    name.header = { DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, sizeof(name), paths[index].sourceInfo.adapterId, paths[index].sourceInfo.id };
    if (DisplayConfigGetDeviceInfo(&name.header) != ERROR_SUCCESS) throw std::runtime_error("Cannot identify display source.");
    return ProfileUtf8(name.viewGdiDeviceName);
  }
  std::string Fingerprint(size_t index, NvU32 nvDriver) const {
    const auto name = Name(index); const auto gdi = Gdi(index);
    DISPLAY_DEVICEA adapter{}; adapter.cb = sizeof(adapter);
    std::string adapterId, driverVersion;
    for (DWORD i = 0; EnumDisplayDevicesA(nullptr, i, &adapter, 0); ++i) {
      if (gdi != adapter.DeviceName) continue;
      adapterId = adapter.DeviceID;
      const std::string prefix = "\\Registry\\Machine\\";
      std::string key = adapter.DeviceKey;
      if (key.rfind(prefix, 0) == 0) {
        char version[512]{}; DWORD bytes = sizeof(version);
        if (RegGetValueA(HKEY_LOCAL_MACHINE, key.substr(prefix.size()).c_str(), "DriverVersion", RRF_RT_REG_SZ, nullptr, version, &bytes) == ERROR_SUCCESS)
          driverVersion = version;
      }
      break;
    }
    return ProfileUtf8(name.monitorDevicePath) + ":" + std::to_string(name.edidManufactureId) + ":" + std::to_string(name.edidProductCodeId)
      + ":" + adapterId + ":" + driverVersion + ":" + std::to_string(nvDriver);
  }
  size_t Find(const std::string& identity) const {
    size_t match = paths.size();
    for (size_t i = 0; i < paths.size(); ++i) {
      if (ProfileUtf8(Name(i).monitorDevicePath) == identity) {
        if (match != paths.size()) throw std::runtime_error("Ambiguous monitor identity.");
        match = i;
      }
    }
    if (match == paths.size()) throw std::runtime_error("The saved monitor is not connected.");
    return match;
  }
  void RequireIndependent(size_t index) const {
    const auto& source = paths[index].sourceInfo;
    for (size_t i = 0; i < paths.size(); ++i) {
      if (i != index && paths[i].sourceInfo.id == source.id &&
          std::memcmp(&paths[i].sourceInfo.adapterId, &source.adapterId, sizeof(LUID)) == 0)
        throw std::runtime_error("Cloned displays are not supported by display profiles.");
    }
  }
};
struct ProfileNvidia {
  NvApi api;
  ProfileNvGet get = nullptr; ProfileNvSet set = nullptr; NvU32 id = 0, driver = 0;
  std::vector<ProfileNvPath> paths;
  std::vector<ProfileNvSource> sources;
  std::vector<std::vector<ProfileNvTarget>> targets;
  std::vector<std::vector<ProfileNvDetails>> details;
  bool Load(const std::string& gdi) {
    std::string error;
    if (!api.Load(error)) return false;
    auto displayId = reinterpret_cast<ProfileNvDisplayId>(api.Interface(0xAE457190));
    auto driverVersion = reinterpret_cast<ProfileNvDriver>(api.Interface(0x2926AAAD));
    if (!displayId || displayId(gdi.c_str(), &id) != NVAPI_OK) return false;
    NvAPI_ShortString branch{};
    if (!driverVersion || driverVersion(&driver, branch) != NVAPI_OK) return false;
    get = reinterpret_cast<ProfileNvGet>(api.Interface(0x11ABCCF8));
    set = reinterpret_cast<ProfileNvSet>(api.Interface(0x5D8CF8DE));
    if (!get || !set) return false;
    NvU32 count = 0;
    if (get(&count, nullptr) != NVAPI_OK || count == 0 || count > 64) return false;
    paths.resize(count); sources.resize(count); targets.resize(count); details.resize(count);
    for (auto& p : paths) p.version = MakeNvApiVersion(sizeof(ProfileNvPath), 2);
    if (get(&count, paths.data()) != NVAPI_OK) return false;
    for (size_t i = 0; i < paths.size(); ++i) {
      if (paths[i].targetInfoCount > 64) return false;
      targets[i].resize(paths[i].targetInfoCount); details[i].resize(paths[i].targetInfoCount);
      paths[i].targetInfo = targets[i].data(); paths[i].sourceModeInfo = &sources[i];
      for (size_t j = 0; j < targets[i].size(); ++j) {
        details[i][j].version = MakeNvApiVersion(sizeof(ProfileNvDetails), 1);
        targets[i][j].details = &details[i][j];
      }
    }
    return get(&count, paths.data()) == NVAPI_OK && Selected() != nullptr;
  }
  ProfileNvDetails* Selected() {
    for (auto& ts : targets) for (auto& target : ts) if (target.displayId == id) return target.details;
    return nullptr;
  }
  void ApplyScaling(NvS32 scaling) {
    auto* selected = Selected();
    if (!selected || scaling < 0 || scaling > 8 || scaling == 4) throw std::runtime_error("NVIDIA scaling is unavailable.");
    selected->scaling = scaling;
    if (set(static_cast<NvU32>(paths.size()), paths.data(), 0) != NVAPI_OK)
      throw std::runtime_error("NVIDIA rejected the display scaling configuration.");
  }
};
ProfileSnapshot ProfileCapture(ProfileTopology& topology, size_t index, bool vibrance) {
  topology.RequireIndependent(index);
  const auto& path = topology.paths[index];
  if (path.sourceInfo.modeInfoIdx >= topology.modes.size() || path.targetInfo.modeInfoIdx >= topology.modes.size())
    throw std::runtime_error("Active display timing is unavailable.");
  ProfileSnapshot snapshot;
  snapshot.source = topology.modes[path.sourceInfo.modeInfoIdx].sourceMode;
  snapshot.target = topology.modes[path.targetInfo.modeInfoIdx].targetMode;
  snapshot.refresh = path.targetInfo.refreshRate; snapshot.scaling = path.targetInfo.scaling;
  snapshot.scanline = path.targetInfo.scanLineOrdering;
  const auto gdi = topology.Gdi(index);
  ProfileNvidia nv;
  if (nv.Load(gdi)) { snapshot.nvScaling = nv.Selected()->scaling; snapshot.nvRefresh = nv.Selected()->refreshRate1K; }
  std::string error;
  if (vibrance) {
    NvDisplayHandle handle = nullptr;
    snapshot.vibrance.version = NV_DISPLAY_DVC_INFO_EX_VER;
    if (!nv.id || !nv.api.LoadDigitalVibranceInterfaces(error) || nv.api.GetAssociatedDisplay(gdi.c_str(), &handle) != NVAPI_OK ||
        nv.api.GetDvcInfo(handle, &snapshot.vibrance) != NVAPI_OK || snapshot.vibrance.maxLevel <= snapshot.vibrance.minLevel)
      throw std::runtime_error("Digital Vibrance cannot be captured reliably.");
    snapshot.includeVibrance = 1;
  }
  return snapshot;
}
ProfileSnapshot ProfileDecode(const std::string& token) {
  const auto bytes = ProfileUnhex(token);
  if (bytes.size() != sizeof(ProfileSnapshot)) throw std::runtime_error("Unsupported display snapshot.");
  ProfileSnapshot snapshot; std::memcpy(&snapshot, bytes.data(), bytes.size());
  if (snapshot.magic != 0x4e445031 || snapshot.size != sizeof(snapshot) || !snapshot.refresh.Denominator ||
      !snapshot.source.width || !snapshot.source.height || snapshot.source.width > 32768 || snapshot.source.height > 32768 ||
      snapshot.includeVibrance > 1 || snapshot.includeRange > 1)
    throw std::runtime_error("Invalid display snapshot.");
  // Reserved v1 color fields: discard legacy range data before any operation.
  snapshot.includeRange = 0; snapshot.color = {};
  return snapshot;
}
void ProfileApply(const std::string& identity, const ProfileSnapshot& saved, bool validate) {
  ProfileTopology current; const size_t index = current.Find(identity); current.RequireIndependent(index);
  const auto gdi = current.Gdi(index);
  ProfileNvidia nv;
  if (saved.nvScaling >= 0 && !nv.Load(gdi)) throw std::runtime_error("Saved NVIDIA display capabilities are unavailable.");
  if (saved.nvScaling > 8 || saved.nvScaling == 4) throw std::runtime_error("Unsupported NVIDIA scaling mode.");
  // Only accept an existing driver-enumerated desktop mode. Do not invent timings.
  bool enumerated = false; DEVMODEA mode{}; mode.dmSize = sizeof(mode);
  const double hz = static_cast<double>(saved.refresh.Numerator) / saved.refresh.Denominator;
  for (DWORD i = 0; EnumDisplaySettingsA(gdi.c_str(), i, &mode); ++i) {
    if (mode.dmPelsWidth == saved.source.width && mode.dmPelsHeight == saved.source.height &&
        std::abs(static_cast<double>(mode.dmDisplayFrequency) - hz) < 1.1) { enumerated = true; break; }
  }
  if (!enumerated) throw std::runtime_error("The saved resolution and refresh rate are no longer available.");
  auto& path = current.paths[index];
  if (path.sourceInfo.modeInfoIdx >= current.modes.size() || path.targetInfo.modeInfoIdx >= current.modes.size())
    throw std::runtime_error("Cannot resolve active display timing.");
  auto& source = current.modes[path.sourceInfo.modeInfoIdx].sourceMode;
  const POINTL position = source.position;
  source = saved.source; source.position = position;
  current.modes[path.targetInfo.modeInfoIdx].targetMode = saved.target;
  path.targetInfo.refreshRate = saved.refresh; path.targetInfo.scaling = saved.scaling; path.targetInfo.scanLineOrdering = saved.scanline;
  const LONG status = SetDisplayConfig(static_cast<UINT32>(current.paths.size()), current.paths.data(),
    // Persist applied modes in Windows' display database, including rollback.
    // Preflight remains read-only and must never save a configuration.
    static_cast<UINT32>(current.modes.size()), current.modes.data(),
    SDC_USE_SUPPLIED_DISPLAY_CONFIG | (validate ? SDC_VALIDATE : (SDC_APPLY | SDC_SAVE_TO_DATABASE)));
  if (status != ERROR_SUCCESS) throw std::runtime_error("Windows rejected the saved display configuration (" + std::to_string(status) + ").");
  if (!validate && saved.nvScaling >= 0) {
    // Reload after the Windows mode change; preserve all other NVIDIA paths.
    ProfileNvidia updated;
    if (!updated.Load(gdi)) throw std::runtime_error("Cannot reload NVIDIA display state.");
    // Some drivers change scaling even with NV_DISPLAYCONFIG_VALIDATE_ONLY.
    // Preflight must remain read-only; verify scaling after the guarded apply.
    updated.ApplyScaling(saved.nvScaling);
  }
  if (!validate && saved.includeVibrance) {
    NvApi colors; std::string error;
    if (!colors.Load(error)) throw std::runtime_error(error);
    if (saved.includeVibrance) {
      NvDisplayHandle handle = nullptr; auto value = saved.vibrance;
      if (!colors.LoadDigitalVibranceInterfaces(error) || colors.GetAssociatedDisplay(gdi.c_str(), &handle) != NVAPI_OK ||
          colors.SetDvcLevel(handle, &value) != NVAPI_OK) throw std::runtime_error("Cannot restore Digital Vibrance.");
    }
  }
}
void ProfilePrint(ProfileTopology& topology, size_t index, const ProfileSnapshot& snapshot) {
  auto name = topology.Name(index); const auto identity = ProfileUtf8(name.monitorDevicePath);
  ProfileNvidia nv; const bool hasNv = nv.Load(topology.Gdi(index));
  const auto& signal = snapshot.target.targetVideoSignalInfo;
  std::cout << "{\"id\":\"" << EscapeJson(identity) << "\",\"name\":\"" << EscapeJson(ProfileUtf8(name.monitorFriendlyDeviceName))
    << "\",\"fingerprint\":\"" << EscapeJson(topology.Fingerprint(index, nv.driver))
    << "\",\"width\":" << snapshot.source.width << ",\"height\":" << snapshot.source.height
    << ",\"refresh\":{\"numerator\":" << snapshot.refresh.Numerator << ",\"denominator\":" << snapshot.refresh.Denominator
    << "},\"signal\":{\"width\":" << signal.activeSize.cx << ",\"height\":" << signal.activeSize.cy
    << ",\"numerator\":" << signal.vSyncFreq.Numerator << ",\"denominator\":" << signal.vSyncFreq.Denominator
    << "},\"nativeState\":{\"pixelRate\":\"" << signal.pixelRate << "\",\"totalWidth\":" << signal.totalSize.cx
    << ",\"totalHeight\":" << signal.totalSize.cy << ",\"windowsScaling\":" << snapshot.scaling << ",\"scanline\":" << snapshot.scanline
    << ",\"vibrance\":" << (snapshot.includeVibrance ? snapshot.vibrance.currentLevel : -1)
    << "},\"scaling\":" << snapshot.nvScaling << ",\"vibrance\":";
  if (snapshot.includeVibrance) std::cout << ToPercent(snapshot.vibrance, snapshot.vibrance.currentLevel); else std::cout << "null";
  std::cout << ",\"capabilities\":{\"nvidiaScaling\":" << (hasNv ? "true" : "false")
    << ",\"vibrance\":" << (snapshot.includeVibrance ? "true" : "false")
    << "},\"token\":\"" << ProfileHex(&snapshot, sizeof(snapshot)) << "\"}";
}
int RunDisplayProfileCommand(int argc, char** argv) {
  const std::string command = argv[1]; std::string monitor, token, fallbackToken; bool vibrance = false;
  DWORD owner = 0; bool confirmed = false;
  for (int i = 2; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--monitor" && i + 1 < argc) { auto bytes = ProfileUnhex(argv[++i]); monitor.assign(bytes.begin(), bytes.end()); }
    else if (arg == "--token" && i + 1 < argc) token = argv[++i];
    else if (arg == "--fallback-token" && i + 1 < argc) fallbackToken = argv[++i];
    else if (arg == "--owner" && i + 1 < argc) owner = static_cast<DWORD>(std::stoul(argv[++i]));
    else if (arg == "--vibrance") vibrance = true;
    else if (arg == "--confirmed") confirmed = true;
    else throw std::runtime_error("Unknown display profile argument.");
  }
  if (command == "profile-list" || command == "profile-capture") {
    ProfileTopology topology;
    if (command == "profile-list") {
      std::cout << "{\"displays\":["; bool first = true;
      for (size_t i = 0; i < topology.paths.size(); ++i) {
        try {
          auto snapshot = ProfileCapture(topology, i, false);
          // Probe optional properties independently; unavailable is never a zero value.
          try { snapshot = ProfileCapture(topology, i, true); } catch (const std::exception&) {}
          if (!first) std::cout << ','; first = false; ProfilePrint(topology, i, snapshot);
        } catch (const std::exception&) { /* Clone/unavailable paths are not selectable. */ }
      }
      std::cout << "]}\n";
    } else { const auto index = topology.Find(monitor); auto snapshot = ProfileCapture(topology, index, vibrance); ProfilePrint(topology, index, snapshot); std::cout << '\n'; }
    return 0;
  }
  if (monitor.empty() || token.empty()) throw std::runtime_error("Monitor and snapshot are required.");
  auto saved = ProfileDecode(token);
  if (command == "profile-merge") {
    const auto fallback = ProfileDecode(fallbackToken);
    if (!saved.includeVibrance && fallback.includeVibrance) { saved.vibrance = fallback.vibrance; saved.includeVibrance = 1; }
    ProfileTopology topology; const auto index = topology.Find(monitor);
    ProfilePrint(topology, index, saved); std::cout << '\n'; return 0;
  }
  auto expected = saved;
  if (command == "profile-validate" || command == "profile-apply") {
    ProfileApply(monitor, saved, command == "profile-validate");
    std::cout << "{\"ok\":true}\n"; return 0;
  }
  if (command != "profile-watch" || owner == 0 || owner == GetCurrentProcessId()) throw std::runtime_error("Invalid display profile command.");
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, owner);
  if (!parent) throw std::runtime_error("Cannot watch the Nova process.");
  ProfileTopology initialTopology; const auto initialIndex = initialTopology.Find(monitor);
  ProfileNvidia initialNv; initialNv.Load(initialTopology.Gdi(initialIndex));
  const auto fingerprint = initialTopology.Fingerprint(initialIndex, initialNv.driver);
  const ULONGLONG deadline = GetTickCount64() + 15000;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE); std::string pending;
  std::cout << "{\"ready\":true}\n" << std::flush;
  while (true) {
    DWORD available = 0;
    if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr)) break;
    if (available) {
      char buffer[128]; DWORD read = 0;
      if (!ReadFile(input, buffer, std::min<DWORD>(available, sizeof(buffer)), &read, nullptr)) break;
      pending.append(buffer, read);
      size_t newline;
      while ((newline = pending.find('\n')) != std::string::npos) {
        const auto message = pending.substr(0, newline); pending.erase(0, newline + 1);
        if (message == "disarm") { CloseHandle(parent); return 0; }
        if (message == "confirm") confirmed = true;
        if (message.rfind("expected ", 0) == 0) expected = ProfileDecode(message.substr(9));
        if (message == "restore") { pending.clear(); goto restore; }
      }
      if (pending.size() > 16384) break;
    }
    if (WaitForSingleObject(parent, 0) == WAIT_OBJECT_0 || (!confirmed && GetTickCount64() >= deadline)) break;
    Sleep(100);
  }
restore:
  CloseHandle(parent);
  ProfileTopology restoreTopology; const auto restoreIndex = restoreTopology.Find(monitor);
  ProfileNvidia restoreNv; restoreNv.Load(restoreTopology.Gdi(restoreIndex));
  if (restoreTopology.Fingerprint(restoreIndex, restoreNv.driver) != fingerprint)
    throw std::runtime_error("Monitor or driver changed; recovery requires review.");
  if (confirmed) {
    ProfileTopology current; const auto index = current.Find(monitor);
    const auto actual = ProfileCapture(current, index, saved.includeVibrance != 0);
    auto equal = [](const ProfileSnapshot& a, const ProfileSnapshot& b) {
      return a.source.width == b.source.width && a.source.height == b.source.height && a.nvScaling == b.nvScaling &&
        static_cast<uint64_t>(a.refresh.Numerator) * b.refresh.Denominator == static_cast<uint64_t>(b.refresh.Numerator) * a.refresh.Denominator &&
        std::memcmp(&a.target, &b.target, sizeof(a.target)) == 0 &&
        (!a.includeVibrance || a.vibrance.currentLevel == b.vibrance.currentLevel);
    };
    if (!equal(actual, expected) && !equal(actual, saved)) throw std::runtime_error("Display settings changed outside Nova; recovery requires review.");
  }
  ProfileApply(monitor, saved, false);
  std::cout << "{\"restored\":true}\n" << std::flush; return 0;
}
