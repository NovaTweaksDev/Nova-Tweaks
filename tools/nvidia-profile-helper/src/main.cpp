#include <windows.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <iostream>
#include <string>
#include <string_view>
#include <vector>

using NvU8 = std::uint8_t;
using NvU16 = std::uint16_t;
using NvU32 = std::uint32_t;
using NvS32 = std::int32_t;
using NvAPI_Status = NvS32;

constexpr NvAPI_Status NVAPI_OK = 0;
constexpr NvAPI_Status NVAPI_SETTING_NOT_FOUND = -160;

constexpr NvU32 NVAPI_SHORT_STRING_MAX = 64;
constexpr NvU32 NVAPI_UNICODE_STRING_MAX = 2048;
constexpr NvU32 NVAPI_BINARY_DATA_MAX = 4096;

using NvAPI_ShortString = char[NVAPI_SHORT_STRING_MAX];
using NvAPI_UnicodeString = wchar_t[NVAPI_UNICODE_STRING_MAX];

using NvDRSSessionHandle = void*;
using NvDRSProfileHandle = void*;

enum NVDRS_SETTING_TYPE {
  NVDRS_DWORD_TYPE = 0,
  NVDRS_BINARY_TYPE = 1,
  NVDRS_STRING_TYPE = 2,
  NVDRS_WSTRING_TYPE = 3
};

enum NVDRS_SETTING_LOCATION {
  NVDRS_CURRENT_PROFILE_LOCATION = 0,
  NVDRS_GLOBAL_PROFILE_LOCATION = 1,
  NVDRS_BASE_PROFILE_LOCATION = 2,
  NVDRS_DEFAULT_PROFILE_LOCATION = 3
};

#pragma pack(push, 8)
struct NVDRS_BINARY_SETTING {
  NvU32 valueLength;
  NvU8 valueData[NVAPI_BINARY_DATA_MAX];
};

struct NVDRS_SETTING {
  NvU32 version;
  NvAPI_UnicodeString settingName;
  NvU32 settingId;
  NVDRS_SETTING_TYPE settingType;
  NVDRS_SETTING_LOCATION settingLocation;
  NvU32 isCurrentPredefined;
  NvU32 isPredefinedValid;
  union {
    NvU32 u32PredefinedValue;
    NVDRS_BINARY_SETTING binaryPredefinedValue;
    NvAPI_UnicodeString wszPredefinedValue;
  };
  union {
    NvU32 u32CurrentValue;
    NVDRS_BINARY_SETTING binaryCurrentValue;
    NvAPI_UnicodeString wszCurrentValue;
  };
};
#pragma pack(pop)

constexpr NvU32 MakeNvApiVersion(std::size_t structSize, NvU32 version) {
  return static_cast<NvU32>(structSize | (static_cast<std::size_t>(version) << 16));
}

constexpr NvU32 NVDRS_SETTING_VER = MakeNvApiVersion(sizeof(NVDRS_SETTING), 1);

using NvAPI_QueryInterface_t = void*(__cdecl*)(NvU32);
using NvAPI_Initialize_t = NvAPI_Status(__cdecl*)();
using NvAPI_Unload_t = NvAPI_Status(__cdecl*)();
using NvAPI_GetErrorMessage_t = NvAPI_Status(__cdecl*)(NvAPI_Status, NvAPI_ShortString);
using NvAPI_DRS_CreateSession_t = NvAPI_Status(__cdecl*)(NvDRSSessionHandle*);
using NvAPI_DRS_DestroySession_t = NvAPI_Status(__cdecl*)(NvDRSSessionHandle);
using NvAPI_DRS_LoadSettings_t = NvAPI_Status(__cdecl*)(NvDRSSessionHandle);
using NvAPI_DRS_SaveSettings_t = NvAPI_Status(__cdecl*)(NvDRSSessionHandle);
using NvAPI_DRS_RestoreAllDefaults_t = NvAPI_Status(__cdecl*)(NvDRSSessionHandle);
using NvAPI_DRS_GetBaseProfile_t = NvAPI_Status(__cdecl*)(NvDRSSessionHandle, NvDRSProfileHandle*);
using NvAPI_DRS_SetSetting_t = NvAPI_Status(__cdecl*)(NvDRSSessionHandle, NvDRSProfileHandle, NVDRS_SETTING*);
using NvAPI_DRS_RestoreProfileDefaultSetting_t =
    NvAPI_Status(__cdecl*)(NvDRSSessionHandle, NvDRSProfileHandle, NvU32);

constexpr NvU32 NVAPI_ID_INITIALIZE = 0x0150E828;
constexpr NvU32 NVAPI_ID_UNLOAD = 0xD22BDD7E;
constexpr NvU32 NVAPI_ID_GET_ERROR_MESSAGE = 0x6C2D048C;
constexpr NvU32 NVAPI_ID_DRS_CREATE_SESSION = 0x0694D52E;
constexpr NvU32 NVAPI_ID_DRS_DESTROY_SESSION = 0xDAD9CFF8;
constexpr NvU32 NVAPI_ID_DRS_LOAD_SETTINGS = 0x375DBD6B;
constexpr NvU32 NVAPI_ID_DRS_SAVE_SETTINGS = 0xFCBC7E14;
constexpr NvU32 NVAPI_ID_DRS_RESTORE_ALL_DEFAULTS = 0x5927B094;
constexpr NvU32 NVAPI_ID_DRS_SET_SETTING = 0x577DD202;
constexpr NvU32 NVAPI_ID_DRS_RESTORE_PROFILE_DEFAULT_SETTING = 0x53F0381E;
constexpr NvU32 NVAPI_ID_DRS_GET_BASE_PROFILE = 0xDA8466A0;

constexpr NvU32 PREFERRED_PSTATE_ID = 0x1057EB71;
constexpr NvU32 REFRESH_RATE_OVERRIDE_ID = 0x0064B541;
constexpr NvU32 VSYNCMODE_ID = 0x00A879CF;
constexpr NvU32 OGL_TRIPLE_BUFFER_ID = 0x20FDD1F9;
constexpr NvU32 FRL_FPS_ID = 0x10835002;
constexpr NvU32 APPIDLE_DYNAMIC_FRL_FPS_ID = 0x10835016;
constexpr NvU32 PS_SHADERDISKCACHE_ID = 0x00198FFF;
constexpr NvU32 PS_SHADERDISKCACHE_MAX_SIZE_ID = 0x00AC8497;
constexpr NvU32 QUALITY_ENHANCEMENTS_ID = 0x00CE2691;
constexpr NvU32 PS_TEXFILTER_ANISO_OPTS2_ID = 0x00E73211;
constexpr NvU32 PS_TEXFILTER_DISABLE_TRILIN_SLOPE_ID = 0x002ECAF2;
constexpr NvU32 PS_TEXFILTER_NO_NEG_LODBIAS_ID = 0x0019BB68;
constexpr NvU32 OGL_THREAD_CONTROL_ID = 0x20C1221E;
constexpr NvU32 FXAA_ENABLE_ID = 0x1074C972;
constexpr NvU32 AA_GAMMA_CORRECTION_ID = 0x107D639D;
constexpr NvU32 AA_MODE_SELECTOR_ID = 0x107EFC5B;
constexpr NvU32 AA_MODE_REPLAY_ID = 0x10D48A85;
constexpr NvU32 ANISO_MODE_SELECTOR_ID = 0x10D2BB16;
constexpr NvU32 MAXWELL_B_SAMPLE_INTERLEAVE_ID = 0x0098C1AC;
constexpr NvU32 CUDA_EXCLUDED_GPUS_ID = 0x10354FF8;
constexpr NvU32 NV_QUALITY_UPSCALING_ID = 0x10444444;
constexpr NvU32 AO_MODE_ID = 0x00667329;
constexpr NvU32 AO_MODE_ACTIVE_ID = 0x00664339;
constexpr NvU32 PRERENDERLIMIT_ID = 0x007BA09E;
constexpr NvU32 VR_PRERENDERLIMIT_ID = 0x10111133;
constexpr NvU32 GSYNC_PROFILE_OVERRIDE_ID = 0x10A879CF;
constexpr NvU32 GSYNC_PROFILE_OVERRIDE_OGL_ID = 0x10A879AC;

constexpr NvU32 PREFERRED_PSTATE_PREFER_MAX = 0x00000001;
constexpr NvU32 PREFERRED_PSTATE_OPTIMAL_POWER = 0x00000005;
constexpr NvU32 REFRESH_RATE_OVERRIDE_APPLICATION_CONTROLLED = 0x00000000;
constexpr NvU32 REFRESH_RATE_OVERRIDE_HIGHEST_AVAILABLE = 0x00000001;
constexpr NvU32 VSYNCMODE_PASSIVE = 0x60925292;
constexpr NvU32 VSYNCMODE_FORCEOFF = 0x08416747;
constexpr NvU32 OGL_TRIPLE_BUFFER_DISABLED = 0x00000000;
constexpr NvU32 FRL_FPS_DISABLED = 0x00000000;
constexpr NvU32 FRL_FPS_DETECTION_FALLBACK = 0x000000ED;
constexpr NvU32 PS_SHADERDISKCACHE_ON = 0x00000001;
constexpr NvU32 PS_SHADERDISKCACHE_MAX_SIZE_DEFAULT = 0x00004000;
constexpr NvU32 PS_SHADERDISKCACHE_MAX_SIZE_UNLIMITED = 0xFFFFFFFF;
constexpr NvU32 QUALITY_ENHANCEMENTS_HIGHQUALITY = 0xFFFFFFF6;
constexpr NvU32 QUALITY_ENHANCEMENTS_QUALITY = 0x00000000;
constexpr NvU32 QUALITY_ENHANCEMENTS_HIGHPERFORMANCE = 0x00000014;
constexpr NvU32 PS_TEXFILTER_ANISO_OPTS2_OFF = 0x00000000;
constexpr NvU32 PS_TEXFILTER_ANISO_OPTS2_ON = 0x00000001;
constexpr NvU32 PS_TEXFILTER_DISABLE_TRILIN_SLOPE_OFF = 0x00000000;
constexpr NvU32 PS_TEXFILTER_DISABLE_TRILIN_SLOPE_ON = 0x00000001;
constexpr NvU32 PS_TEXFILTER_NO_NEG_LODBIAS_OFF = 0x00000000;
constexpr NvU32 PS_TEXFILTER_NO_NEG_LODBIAS_ON = 0x00000001;
constexpr NvU32 OGL_THREAD_CONTROL_DEFAULT = 0x00000000;
constexpr NvU32 OGL_THREAD_CONTROL_ENABLE = 0x00000001;
constexpr NvU32 FXAA_ENABLE_OFF = 0x00000000;
constexpr NvU32 AA_GAMMA_CORRECTION_ON = 0x00000002;
constexpr NvU32 AA_MODE_SELECTOR_APP_CONTROL = 0x00000000;
constexpr NvU32 AA_MODE_REPLAY_TRANSPARENCY_DEFAULT = 0x00000000;
constexpr NvU32 ANISO_MODE_SELECTOR_APP = 0x00000000;
constexpr NvU32 MAXWELL_B_SAMPLE_INTERLEAVE_OFF = 0x00000000;
constexpr NvU32 NV_QUALITY_UPSCALING_OFF = 0x00000000;
constexpr NvU32 AO_MODE_OFF = 0x00000000;
constexpr NvU32 AO_MODE_ACTIVE_DISABLED = 0x00000000;
constexpr NvU32 PRERENDERLIMIT_APP_CONTROLLED = 0x00000000;
constexpr NvU32 PRERENDERLIMIT_LOW_LATENCY_APPROX = 0x00000001;
constexpr NvU32 VR_PRERENDERLIMIT_DEFAULT = 0x00000001;
constexpr NvU32 GSYNC_PROFILE_OVERRIDE_FIXED_REFRESH = 0x00000004;

constexpr int EXIT_SUCCESS_CODE = 0;
constexpr int EXIT_INVALID_ARGS = 2;
constexpr int EXIT_NVAPI_INIT_FAILED = 10;
constexpr int EXIT_SESSION_FAILED = 11;
constexpr int EXIT_APPLY_FAILED = 12;
constexpr int EXIT_SAVE_FAILED = 13;

enum class SettingAction {
  SetDword,
  SetWString,
  RestoreDefaultSetting,
  SetPrimaryRefreshMinus3Dword,
};

struct SettingSpec {
  NvU32 id;
  const char* name;
  SettingAction action;
  NvU32 dwordValue;
  const wchar_t* wstringValue;
};

// Competitive preset with public/known-safe DRS keys only.
static const std::array<SettingSpec, 27> kCompetitiveSettings = {{
    {PREFERRED_PSTATE_ID, "Power management mode", SettingAction::SetDword, PREFERRED_PSTATE_PREFER_MAX, nullptr},
    {REFRESH_RATE_OVERRIDE_ID, "Preferred refresh rate", SettingAction::SetDword, REFRESH_RATE_OVERRIDE_APPLICATION_CONTROLLED, nullptr},
    {GSYNC_PROFILE_OVERRIDE_ID, "Monitor Technology", SettingAction::SetDword, GSYNC_PROFILE_OVERRIDE_FIXED_REFRESH, nullptr},
    {GSYNC_PROFILE_OVERRIDE_OGL_ID, "Monitor Technology OpenGL", SettingAction::SetDword, GSYNC_PROFILE_OVERRIDE_FIXED_REFRESH, nullptr},
    {VSYNCMODE_ID, "Vertical Sync", SettingAction::SetDword, VSYNCMODE_PASSIVE, nullptr},
    {OGL_TRIPLE_BUFFER_ID, "Triple buffering", SettingAction::SetDword, OGL_TRIPLE_BUFFER_DISABLED, nullptr},
    {FRL_FPS_ID, "Frame Rate Limiter", SettingAction::SetPrimaryRefreshMinus3Dword, FRL_FPS_DETECTION_FALLBACK, nullptr},
    {APPIDLE_DYNAMIC_FRL_FPS_ID, "Background Application Max Frame Rate", SettingAction::SetDword, FRL_FPS_DISABLED, nullptr},
    {PS_SHADERDISKCACHE_ID, "Shader Cache", SettingAction::SetDword, PS_SHADERDISKCACHE_ON, nullptr},
    {PS_SHADERDISKCACHE_MAX_SIZE_ID, "Shader Cache Size", SettingAction::RestoreDefaultSetting, 0u, nullptr},
    {QUALITY_ENHANCEMENTS_ID, "Texture filtering - Quality", SettingAction::SetDword, QUALITY_ENHANCEMENTS_HIGHPERFORMANCE, nullptr},
    {PS_TEXFILTER_ANISO_OPTS2_ID, "Texture filtering - Anisotropic sample optimization", SettingAction::SetDword, PS_TEXFILTER_ANISO_OPTS2_ON, nullptr},
    {PS_TEXFILTER_DISABLE_TRILIN_SLOPE_ID, "Texture filtering - Trilinear optimization", SettingAction::SetDword, PS_TEXFILTER_DISABLE_TRILIN_SLOPE_ON, nullptr},
    {PS_TEXFILTER_NO_NEG_LODBIAS_ID, "Texture filtering - Negative LOD bias", SettingAction::SetDword, PS_TEXFILTER_NO_NEG_LODBIAS_OFF, nullptr},
    {OGL_THREAD_CONTROL_ID, "Threaded optimization", SettingAction::SetDword, OGL_THREAD_CONTROL_ENABLE, nullptr},
    {FXAA_ENABLE_ID, "Antialiasing - FXAA", SettingAction::SetDword, FXAA_ENABLE_OFF, nullptr},
    {AA_GAMMA_CORRECTION_ID, "Antialiasing - Gamma correction", SettingAction::SetDword, AA_GAMMA_CORRECTION_ON, nullptr},
    {AA_MODE_SELECTOR_ID, "Antialiasing - Mode", SettingAction::SetDword, AA_MODE_SELECTOR_APP_CONTROL, nullptr},
    {AA_MODE_REPLAY_ID, "Antialiasing - Transparency", SettingAction::SetDword, AA_MODE_REPLAY_TRANSPARENCY_DEFAULT, nullptr},
    {ANISO_MODE_SELECTOR_ID, "Anisotropic filtering", SettingAction::SetDword, ANISO_MODE_SELECTOR_APP, nullptr},
    {MAXWELL_B_SAMPLE_INTERLEAVE_ID, "MFAA", SettingAction::SetDword, MAXWELL_B_SAMPLE_INTERLEAVE_OFF, nullptr},
    {CUDA_EXCLUDED_GPUS_ID, "CUDA - GPUs", SettingAction::SetWString, 0u, L"none"},
    {NV_QUALITY_UPSCALING_ID, "Image Scaling", SettingAction::SetDword, NV_QUALITY_UPSCALING_OFF, nullptr},
    {AO_MODE_ID, "Ambient Occlusion", SettingAction::SetDword, AO_MODE_OFF, nullptr},
    {AO_MODE_ACTIVE_ID, "Ambient Occlusion active flag", SettingAction::SetDword, AO_MODE_ACTIVE_DISABLED, nullptr},
    // Low Latency Mode Ultra approximation: PRERENDERLIMIT=1.
    {PRERENDERLIMIT_ID, "Low Latency Mode approximation", SettingAction::SetDword, PRERENDERLIMIT_LOW_LATENCY_APPROX, nullptr},
    {VR_PRERENDERLIMIT_ID, "Virtual Reality pre-rendered frames", SettingAction::SetDword, VR_PRERENDERLIMIT_DEFAULT, nullptr},
}};

static const std::array<SettingSpec, 23> kBalancedSettings = {{
    {PREFERRED_PSTATE_ID, "Power management mode", SettingAction::SetDword, PREFERRED_PSTATE_OPTIMAL_POWER, nullptr},
    {REFRESH_RATE_OVERRIDE_ID, "Preferred refresh rate", SettingAction::SetDword, REFRESH_RATE_OVERRIDE_APPLICATION_CONTROLLED, nullptr},
    {VSYNCMODE_ID, "Vertical Sync", SettingAction::SetDword, VSYNCMODE_PASSIVE, nullptr},
    {OGL_TRIPLE_BUFFER_ID, "Triple buffering", SettingAction::SetDword, OGL_TRIPLE_BUFFER_DISABLED, nullptr},
    {FRL_FPS_ID, "Frame Rate Limiter", SettingAction::SetDword, FRL_FPS_DISABLED, nullptr},
    {APPIDLE_DYNAMIC_FRL_FPS_ID, "Idle Application Max FPS Limit", SettingAction::RestoreDefaultSetting, 0u, nullptr},
    {PS_SHADERDISKCACHE_ID, "Shader Cache", SettingAction::SetDword, PS_SHADERDISKCACHE_ON, nullptr},
    {PS_SHADERDISKCACHE_MAX_SIZE_ID, "Shader disk cache maximum size", SettingAction::SetDword, PS_SHADERDISKCACHE_MAX_SIZE_DEFAULT, nullptr},
    {QUALITY_ENHANCEMENTS_ID, "Texture filtering - Quality", SettingAction::SetDword, QUALITY_ENHANCEMENTS_QUALITY, nullptr},
    {PS_TEXFILTER_ANISO_OPTS2_ID, "Texture filtering - Anisotropic sample optimization", SettingAction::SetDword, PS_TEXFILTER_ANISO_OPTS2_OFF, nullptr},
    {PS_TEXFILTER_DISABLE_TRILIN_SLOPE_ID, "Texture filtering - Trilinear optimization", SettingAction::SetDword, PS_TEXFILTER_DISABLE_TRILIN_SLOPE_OFF, nullptr},
    {PS_TEXFILTER_NO_NEG_LODBIAS_ID, "Texture filtering - Negative LOD bias", SettingAction::SetDword, PS_TEXFILTER_NO_NEG_LODBIAS_ON, nullptr},
    {OGL_THREAD_CONTROL_ID, "Threaded optimization", SettingAction::SetDword, OGL_THREAD_CONTROL_DEFAULT, nullptr},
    {FXAA_ENABLE_ID, "Antialiasing - FXAA", SettingAction::SetDword, FXAA_ENABLE_OFF, nullptr},
    {AA_MODE_SELECTOR_ID, "Antialiasing - Mode", SettingAction::SetDword, AA_MODE_SELECTOR_APP_CONTROL, nullptr},
    {AA_MODE_REPLAY_ID, "Antialiasing - Transparency", SettingAction::SetDword, AA_MODE_REPLAY_TRANSPARENCY_DEFAULT, nullptr},
    {ANISO_MODE_SELECTOR_ID, "Anisotropic filtering", SettingAction::SetDword, ANISO_MODE_SELECTOR_APP, nullptr},
    {MAXWELL_B_SAMPLE_INTERLEAVE_ID, "MFAA", SettingAction::SetDword, MAXWELL_B_SAMPLE_INTERLEAVE_OFF, nullptr},
    {CUDA_EXCLUDED_GPUS_ID, "CUDA - GPUs", SettingAction::SetWString, 0u, L"none"},
    {NV_QUALITY_UPSCALING_ID, "Image Scaling", SettingAction::SetDword, NV_QUALITY_UPSCALING_OFF, nullptr},
    {AO_MODE_ID, "Ambient Occlusion", SettingAction::SetDword, AO_MODE_OFF, nullptr},
    {AO_MODE_ACTIVE_ID, "Ambient Occlusion active flag", SettingAction::SetDword, AO_MODE_ACTIVE_DISABLED, nullptr},
    {PRERENDERLIMIT_ID, "Maximum pre-rendered frames", SettingAction::SetDword, PRERENDERLIMIT_APP_CONTROLLED, nullptr},
}};

static const std::array<SettingSpec, 23> kQualitySettings = {{
    {PREFERRED_PSTATE_ID, "Power management mode", SettingAction::SetDword, PREFERRED_PSTATE_OPTIMAL_POWER, nullptr},
    {REFRESH_RATE_OVERRIDE_ID, "Preferred refresh rate", SettingAction::SetDword, REFRESH_RATE_OVERRIDE_APPLICATION_CONTROLLED, nullptr},
    {VSYNCMODE_ID, "Vertical Sync", SettingAction::SetDword, VSYNCMODE_PASSIVE, nullptr},
    {OGL_TRIPLE_BUFFER_ID, "Triple buffering", SettingAction::SetDword, OGL_TRIPLE_BUFFER_DISABLED, nullptr},
    {FRL_FPS_ID, "Frame Rate Limiter", SettingAction::SetDword, FRL_FPS_DISABLED, nullptr},
    {APPIDLE_DYNAMIC_FRL_FPS_ID, "Idle Application Max FPS Limit", SettingAction::RestoreDefaultSetting, 0u, nullptr},
    {PS_SHADERDISKCACHE_ID, "Shader Cache", SettingAction::SetDword, PS_SHADERDISKCACHE_ON, nullptr},
    {PS_SHADERDISKCACHE_MAX_SIZE_ID, "Shader disk cache maximum size", SettingAction::SetDword, PS_SHADERDISKCACHE_MAX_SIZE_DEFAULT, nullptr},
    {QUALITY_ENHANCEMENTS_ID, "Texture filtering - Quality", SettingAction::SetDword, QUALITY_ENHANCEMENTS_HIGHQUALITY, nullptr},
    {PS_TEXFILTER_ANISO_OPTS2_ID, "Texture filtering - Anisotropic sample optimization", SettingAction::SetDword, PS_TEXFILTER_ANISO_OPTS2_OFF, nullptr},
    {PS_TEXFILTER_DISABLE_TRILIN_SLOPE_ID, "Texture filtering - Trilinear optimization", SettingAction::SetDword, PS_TEXFILTER_DISABLE_TRILIN_SLOPE_OFF, nullptr},
    {PS_TEXFILTER_NO_NEG_LODBIAS_ID, "Texture filtering - Negative LOD bias", SettingAction::SetDword, PS_TEXFILTER_NO_NEG_LODBIAS_ON, nullptr},
    {OGL_THREAD_CONTROL_ID, "Threaded optimization", SettingAction::SetDword, OGL_THREAD_CONTROL_DEFAULT, nullptr},
    {FXAA_ENABLE_ID, "Antialiasing - FXAA", SettingAction::SetDword, FXAA_ENABLE_OFF, nullptr},
    {AA_MODE_SELECTOR_ID, "Antialiasing - Mode", SettingAction::SetDword, AA_MODE_SELECTOR_APP_CONTROL, nullptr},
    {AA_MODE_REPLAY_ID, "Antialiasing - Transparency", SettingAction::SetDword, AA_MODE_REPLAY_TRANSPARENCY_DEFAULT, nullptr},
    {ANISO_MODE_SELECTOR_ID, "Anisotropic filtering", SettingAction::SetDword, ANISO_MODE_SELECTOR_APP, nullptr},
    {MAXWELL_B_SAMPLE_INTERLEAVE_ID, "MFAA", SettingAction::SetDword, MAXWELL_B_SAMPLE_INTERLEAVE_OFF, nullptr},
    {CUDA_EXCLUDED_GPUS_ID, "CUDA - GPUs", SettingAction::SetWString, 0u, L"none"},
    {NV_QUALITY_UPSCALING_ID, "Image Scaling", SettingAction::SetDword, NV_QUALITY_UPSCALING_OFF, nullptr},
    {AO_MODE_ID, "Ambient Occlusion", SettingAction::SetDword, AO_MODE_OFF, nullptr},
    {AO_MODE_ACTIVE_ID, "Ambient Occlusion active flag", SettingAction::SetDword, AO_MODE_ACTIVE_DISABLED, nullptr},
    {PRERENDERLIMIT_ID, "Maximum pre-rendered frames", SettingAction::SetDword, PRERENDERLIMIT_APP_CONTROLLED, nullptr},
}};

// Excluded because this helper has no reviewed, stable public DRS-key mapping for them:
// - OpenGL rendering GPU = primary GPU
// - Multi-display/mixed-GPU acceleration
// - SILK Smoothness
// - WhisperMode
// - Dynamic Boost
// - Virtual Reality Variable Rate Super Sampling

template <typename T>
bool ResolveInterface(T& fn, NvAPI_QueryInterface_t query, NvU32 interfaceId, const char* fnName, std::string& error) {
  fn = reinterpret_cast<T>(query(interfaceId));
  if (fn == nullptr) {
    error = std::string("Failed to resolve ") + fnName + " via NvAPI_QueryInterface.";
    return false;
  }
  return true;
}

class NvApi {
 public:
  ~NvApi() { Shutdown(); }

  bool Load(std::string& error) {
    module_ = ::LoadLibraryW(L"nvapi64.dll");
    if (module_ == nullptr) {
      module_ = ::LoadLibraryW(L"nvapi.dll");
    }
    if (module_ == nullptr) {
      error = "Could not load nvapi64.dll or nvapi.dll.";
      return false;
    }

    auto query = reinterpret_cast<NvAPI_QueryInterface_t>(::GetProcAddress(module_, "nvapi_QueryInterface"));
    if (query == nullptr) {
      query = reinterpret_cast<NvAPI_QueryInterface_t>(::GetProcAddress(module_, "nvapi_QueryInterface@4"));
    }
    if (query == nullptr) {
      error = "Could not locate nvapi_QueryInterface export.";
      UnloadLibraryOnly();
      return false;
    }

    if (!ResolveInterface(initialize_, query, NVAPI_ID_INITIALIZE, "NvAPI_Initialize", error) ||
        !ResolveInterface(unload_, query, NVAPI_ID_UNLOAD, "NvAPI_Unload", error) ||
        !ResolveInterface(getErrorMessage_, query, NVAPI_ID_GET_ERROR_MESSAGE, "NvAPI_GetErrorMessage", error) ||
        !ResolveInterface(drsCreateSession_, query, NVAPI_ID_DRS_CREATE_SESSION, "NvAPI_DRS_CreateSession", error) ||
        !ResolveInterface(drsDestroySession_, query, NVAPI_ID_DRS_DESTROY_SESSION, "NvAPI_DRS_DestroySession", error) ||
        !ResolveInterface(drsLoadSettings_, query, NVAPI_ID_DRS_LOAD_SETTINGS, "NvAPI_DRS_LoadSettings", error) ||
        !ResolveInterface(drsSaveSettings_, query, NVAPI_ID_DRS_SAVE_SETTINGS, "NvAPI_DRS_SaveSettings", error) ||
        !ResolveInterface(drsRestoreAllDefaults_, query, NVAPI_ID_DRS_RESTORE_ALL_DEFAULTS,
                          "NvAPI_DRS_RestoreAllDefaults", error) ||
        !ResolveInterface(drsSetSetting_, query, NVAPI_ID_DRS_SET_SETTING, "NvAPI_DRS_SetSetting", error) ||
        !ResolveInterface(drsRestoreProfileDefaultSetting_, query, NVAPI_ID_DRS_RESTORE_PROFILE_DEFAULT_SETTING,
                          "NvAPI_DRS_RestoreProfileDefaultSetting", error) ||
        !ResolveInterface(drsGetBaseProfile_, query, NVAPI_ID_DRS_GET_BASE_PROFILE, "NvAPI_DRS_GetBaseProfile", error)) {
      UnloadLibraryOnly();
      return false;
    }

    const NvAPI_Status status = initialize_();
    if (status != NVAPI_OK) {
      error = std::string("NvAPI_Initialize failed: ") + StatusToString(status);
      UnloadLibraryOnly();
      return false;
    }
    initialized_ = true;
    return true;
  }

  void Shutdown() {
    if (initialized_ && unload_ != nullptr) {
      unload_();
      initialized_ = false;
    }
    UnloadLibraryOnly();
  }

  std::string StatusToString(NvAPI_Status status) const {
    if (getErrorMessage_ != nullptr) {
      NvAPI_ShortString message{};
      const NvAPI_Status rc = getErrorMessage_(status, message);
      if (rc == NVAPI_OK && message[0] != '\0') {
        return std::string(message);
      }
    }
    return "status " + std::to_string(status);
  }

  NvAPI_Status DrsCreateSession(NvDRSSessionHandle* session) const { return drsCreateSession_(session); }
  NvAPI_Status DrsDestroySession(NvDRSSessionHandle session) const { return drsDestroySession_(session); }
  NvAPI_Status DrsLoadSettings(NvDRSSessionHandle session) const { return drsLoadSettings_(session); }
  NvAPI_Status DrsSaveSettings(NvDRSSessionHandle session) const { return drsSaveSettings_(session); }
  NvAPI_Status DrsRestoreAllDefaults(NvDRSSessionHandle session) const { return drsRestoreAllDefaults_(session); }
  NvAPI_Status DrsGetBaseProfile(NvDRSSessionHandle session, NvDRSProfileHandle* profile) const {
    return drsGetBaseProfile_(session, profile);
  }
  NvAPI_Status DrsSetSetting(NvDRSSessionHandle session, NvDRSProfileHandle profile, NVDRS_SETTING* setting) const {
    return drsSetSetting_(session, profile, setting);
  }
  NvAPI_Status DrsRestoreProfileDefaultSetting(NvDRSSessionHandle session, NvDRSProfileHandle profile,
                                               NvU32 settingId) const {
    return drsRestoreProfileDefaultSetting_(session, profile, settingId);
  }

 private:
  void UnloadLibraryOnly() {
    if (module_ != nullptr) {
      ::FreeLibrary(module_);
      module_ = nullptr;
    }

    initialize_ = nullptr;
    unload_ = nullptr;
    getErrorMessage_ = nullptr;
    drsCreateSession_ = nullptr;
    drsDestroySession_ = nullptr;
    drsLoadSettings_ = nullptr;
    drsSaveSettings_ = nullptr;
    drsRestoreAllDefaults_ = nullptr;
    drsSetSetting_ = nullptr;
    drsRestoreProfileDefaultSetting_ = nullptr;
    drsGetBaseProfile_ = nullptr;
  }

  HMODULE module_ = nullptr;
  bool initialized_ = false;

  NvAPI_Initialize_t initialize_ = nullptr;
  NvAPI_Unload_t unload_ = nullptr;
  NvAPI_GetErrorMessage_t getErrorMessage_ = nullptr;
  NvAPI_DRS_CreateSession_t drsCreateSession_ = nullptr;
  NvAPI_DRS_DestroySession_t drsDestroySession_ = nullptr;
  NvAPI_DRS_LoadSettings_t drsLoadSettings_ = nullptr;
  NvAPI_DRS_SaveSettings_t drsSaveSettings_ = nullptr;
  NvAPI_DRS_RestoreAllDefaults_t drsRestoreAllDefaults_ = nullptr;
  NvAPI_DRS_SetSetting_t drsSetSetting_ = nullptr;
  NvAPI_DRS_RestoreProfileDefaultSetting_t drsRestoreProfileDefaultSetting_ = nullptr;
  NvAPI_DRS_GetBaseProfile_t drsGetBaseProfile_ = nullptr;
};

class DrsSessionGuard {
 public:
  explicit DrsSessionGuard(const NvApi& api) : api_(api) {}
  ~DrsSessionGuard() {
    if (session_ != nullptr) {
      api_.DrsDestroySession(session_);
    }
  }

  bool Open(std::string& error) {
    NvAPI_Status status = api_.DrsCreateSession(&session_);
    if (status != NVAPI_OK) {
      error = std::string("NvAPI_DRS_CreateSession failed: ") + api_.StatusToString(status);
      return false;
    }

    status = api_.DrsLoadSettings(session_);
    if (status != NVAPI_OK) {
      error = std::string("NvAPI_DRS_LoadSettings failed: ") + api_.StatusToString(status);
      return false;
    }

    status = api_.DrsGetBaseProfile(session_, &baseProfile_);
    if (status != NVAPI_OK) {
      error = std::string("NvAPI_DRS_GetBaseProfile failed: ") + api_.StatusToString(status);
      return false;
    }
    return true;
  }

  bool Save(std::string& error) const {
    const NvAPI_Status status = api_.DrsSaveSettings(session_);
    if (status != NVAPI_OK) {
      error = std::string("NvAPI_DRS_SaveSettings failed: ") + api_.StatusToString(status);
      return false;
    }
    return true;
  }

  NvDRSSessionHandle Session() const { return session_; }
  NvDRSProfileHandle BaseProfile() const { return baseProfile_; }

 private:
  const NvApi& api_;
  NvDRSSessionHandle session_ = nullptr;
  NvDRSProfileHandle baseProfile_ = nullptr;
};

void PrintUsage(std::ostream& os) {
  os << "Usage:\n";
  os << "  nvidia-profile-helper apply --preset competitive\n";
  os << "  nvidia-profile-helper apply --preset balanced\n";
  os << "  nvidia-profile-helper apply --preset quality\n";
  os << "  nvidia-profile-helper detect-refresh\n";
  os << "  nvidia-profile-helper restore-defaults\n";
}

std::string ToLowerCopy(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
  return value;
}

NvAPI_Status SetDwordSetting(const NvApi& api, NvDRSSessionHandle session, NvDRSProfileHandle profile, NvU32 settingId,
                             NvU32 value) {
  NVDRS_SETTING setting{};
  setting.version = NVDRS_SETTING_VER;
  setting.settingId = settingId;
  setting.settingType = NVDRS_DWORD_TYPE;
  setting.u32CurrentValue = value;
  return api.DrsSetSetting(session, profile, &setting);
}

NvAPI_Status SetWStringSetting(const NvApi& api, NvDRSSessionHandle session, NvDRSProfileHandle profile, NvU32 settingId,
                               const wchar_t* value) {
  NVDRS_SETTING setting{};
  setting.version = NVDRS_SETTING_VER;
  setting.settingId = settingId;
  setting.settingType = NVDRS_WSTRING_TYPE;
  if (value != nullptr) {
    (void)wcsncpy_s(setting.wszCurrentValue, value, _TRUNCATE);
  }
  return api.DrsSetSetting(session, profile, &setting);
}

bool TryRoundRefreshRateHz(const DISPLAYCONFIG_RATIONAL& refreshRate, NvU32& refreshRateHz) {
  if (refreshRate.Denominator == 0u) {
    return false;
  }

  const std::uint64_t numerator = refreshRate.Numerator;
  const std::uint64_t denominator = refreshRate.Denominator;
  const std::uint64_t rounded = (numerator + (denominator / 2u)) / denominator;
  if (rounded == 0u || rounded > UINT32_MAX) {
    return false;
  }

  refreshRateHz = static_cast<NvU32>(rounded);
  return true;
}

bool TryGetActiveRefreshRateHz(NvU32& refreshRateHz) {
  UINT32 pathCount = 0u;
  UINT32 modeCount = 0u;
  LONG result = ::GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pathCount, &modeCount);
  if (result != ERROR_SUCCESS || pathCount == 0u || modeCount == 0u) {
    return false;
  }

  std::vector<DISPLAYCONFIG_PATH_INFO> paths(pathCount);
  std::vector<DISPLAYCONFIG_MODE_INFO> modes(modeCount);
  result = ::QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pathCount, paths.data(), &modeCount, modes.data(), nullptr);
  if (result != ERROR_SUCCESS) {
    return false;
  }

  NvU32 fallbackRefreshRateHz = 0u;
  bool hasFallback = false;

  for (UINT32 pathIndex = 0u; pathIndex < pathCount; ++pathIndex) {
    NvU32 pathRefreshRateHz = 0u;
    if (TryRoundRefreshRateHz(paths[pathIndex].targetInfo.refreshRate, pathRefreshRateHz) &&
        pathRefreshRateHz > fallbackRefreshRateHz) {
      fallbackRefreshRateHz = pathRefreshRateHz;
      hasFallback = true;
    }

    const UINT32 sourceModeIndex = paths[pathIndex].sourceInfo.modeInfoIdx;
    if (sourceModeIndex == DISPLAYCONFIG_PATH_MODE_IDX_INVALID || sourceModeIndex >= modeCount ||
        modes[sourceModeIndex].infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE) {
      continue;
    }

    const DISPLAYCONFIG_SOURCE_MODE& sourceMode = modes[sourceModeIndex].sourceMode;
    if (sourceMode.position.x == 0 && sourceMode.position.y == 0 &&
        TryRoundRefreshRateHz(paths[pathIndex].targetInfo.refreshRate, refreshRateHz)) {
      return true;
    }
  }

  if (hasFallback) {
    refreshRateHz = fallbackRefreshRateHz;
    return true;
  }

  return false;
}

NvU32 ResolvePrimaryRefreshMinus3FrameLimit(std::vector<std::string>& warnings) {
  NvU32 refreshRateHz = 0u;
  if (!TryGetActiveRefreshRateHz(refreshRateHz)) {
    warnings.emplace_back("Could not detect active display refresh rate; using 237 FPS frame limit fallback.");
    return FRL_FPS_DETECTION_FALLBACK;
  }

  if (refreshRateHz <= 3u) {
    warnings.emplace_back("Detected display refresh rate is too low for a minus-3 FPS limit; using 237 FPS fallback.");
    return FRL_FPS_DETECTION_FALLBACK;
  }

  return refreshRateHz - 3u;
}

template <std::size_t N>
int ApplyPreset(const NvApi& api, std::string_view presetName, const std::array<SettingSpec, N>& settings) {
  DrsSessionGuard session(api);
  std::string error;
  if (!session.Open(error)) {
    std::cerr << "ERROR: " << error << "\n";
    return EXIT_SESSION_FAILED;
  }

  std::vector<std::string> warnings;
  warnings.reserve(settings.size());
  std::vector<std::string> infoMessages;

  for (const SettingSpec& spec : settings) {
    NvAPI_Status status = NVAPI_OK;
    switch (spec.action) {
      case SettingAction::SetDword:
        status = SetDwordSetting(api, session.Session(), session.BaseProfile(), spec.id, spec.dwordValue);
        break;
      case SettingAction::SetWString:
        status = SetWStringSetting(api, session.Session(), session.BaseProfile(), spec.id, spec.wstringValue);
        break;
      case SettingAction::RestoreDefaultSetting:
        status = api.DrsRestoreProfileDefaultSetting(session.Session(), session.BaseProfile(), spec.id);
        break;
      case SettingAction::SetPrimaryRefreshMinus3Dword: {
        const NvU32 frameLimit = ResolvePrimaryRefreshMinus3FrameLimit(warnings);
        status = SetDwordSetting(api, session.Session(), session.BaseProfile(), spec.id, frameLimit);
        infoMessages.emplace_back("Frame Rate Limiter set to " + std::to_string(frameLimit) + " FPS.");
        break;
      }
    }

    if (status == NVAPI_SETTING_NOT_FOUND) {
      warnings.emplace_back(std::string(spec.name) + " not found on this system; skipped.");
      continue;
    }

    if (status != NVAPI_OK) {
      std::cerr << "ERROR: Failed to set '" << spec.name << "': " << api.StatusToString(status) << "\n";
      return EXIT_APPLY_FAILED;
    }
  }

  if (!session.Save(error)) {
    std::cerr << "ERROR: " << error << "\n";
    return EXIT_SAVE_FAILED;
  }

  std::cout << "OK: Applied preset " << presetName << "\n";
  for (const std::string& infoMessage : infoMessages) {
    std::cout << "INFO: " << infoMessage << "\n";
  }
  for (const std::string& warning : warnings) {
    std::cout << "WARN: " << warning << "\n";
  }
  return EXIT_SUCCESS_CODE;
}

int DetectRefreshRate() {
  NvU32 refreshRateHz = 0u;
  if (!TryGetActiveRefreshRateHz(refreshRateHz)) {
    std::cerr << "ERROR: Could not detect active display refresh rate\n";
    return EXIT_APPLY_FAILED;
  }
  if (refreshRateHz <= 3u) {
    std::cerr << "ERROR: Detected display refresh rate is too low: " << refreshRateHz << " Hz\n";
    return EXIT_APPLY_FAILED;
  }

  std::cout << "OK: Active display refresh rate " << refreshRateHz << " Hz\n";
  std::cout << "INFO: Competitive frame limit would be " << (refreshRateHz - 3u) << " FPS\n";
  return EXIT_SUCCESS_CODE;
}

int RestoreDefaults(const NvApi& api) {
  DrsSessionGuard session(api);
  std::string error;
  if (!session.Open(error)) {
    std::cerr << "ERROR: " << error << "\n";
    return EXIT_SESSION_FAILED;
  }

  const NvAPI_Status restoreStatus = api.DrsRestoreAllDefaults(session.Session());
  if (restoreStatus != NVAPI_OK) {
    std::cerr << "ERROR: NvAPI_DRS_RestoreAllDefaults failed: " << api.StatusToString(restoreStatus) << "\n";
    return EXIT_APPLY_FAILED;
  }

  if (!session.Save(error)) {
    std::cerr << "ERROR: " << error << "\n";
    return EXIT_SAVE_FAILED;
  }

  std::cout << "OK: Restored global NVIDIA DRS defaults\n";
  return EXIT_SUCCESS_CODE;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    PrintUsage(std::cerr);
    return EXIT_INVALID_ARGS;
  }

  const std::string command = ToLowerCopy(argv[1]);
  const bool isApply = (command == "apply");
  const bool isDetectRefresh = (command == "detect-refresh");
  const bool isRestoreDefaults = (command == "restore-defaults");

  if (!isApply && !isDetectRefresh && !isRestoreDefaults) {
    std::cerr << "ERROR: Unsupported command: " << argv[1] << "\n";
    PrintUsage(std::cerr);
    return EXIT_INVALID_ARGS;
  }

  std::string preset;
  if (isApply) {
    if (argc != 4 || std::string_view(argv[2]) != "--preset") {
      std::cerr << "ERROR: apply requires --preset <competitive|balanced|quality>\n";
      PrintUsage(std::cerr);
      return EXIT_INVALID_ARGS;
    }
    preset = ToLowerCopy(argv[3]);
    if (preset != "competitive" && preset != "balanced" && preset != "quality") {
      std::cerr << "ERROR: Unsupported preset: " << argv[3] << "\n";
      PrintUsage(std::cerr);
      return EXIT_INVALID_ARGS;
    }
  } else if (argc != 2) {
    std::cerr << "ERROR: restore-defaults does not accept extra arguments\n";
    PrintUsage(std::cerr);
    return EXIT_INVALID_ARGS;
  }

  if (isDetectRefresh) {
    return DetectRefreshRate();
  }

  NvApi api;
  std::string loadError;
  if (!api.Load(loadError)) {
    std::cerr << "ERROR: " << loadError << "\n";
    return EXIT_NVAPI_INIT_FAILED;
  }

  if (isRestoreDefaults) {
    return RestoreDefaults(api);
  }
  if (preset == "competitive") {
    return ApplyPreset(api, "competitive", kCompetitiveSettings);
  }
  if (preset == "balanced") {
    return ApplyPreset(api, "balanced", kBalancedSettings);
  }
  return ApplyPreset(api, "quality", kQualitySettings);
}
