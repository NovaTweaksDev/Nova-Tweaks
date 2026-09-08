#include <windows.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <string_view>

using NvU32 = std::uint32_t;
using NvU16 = std::uint16_t;
using NvU8 = std::uint8_t;
using NvS32 = std::int32_t;
using NvAPI_Status = NvS32;
using NvDisplayHandle = void*;

constexpr NvAPI_Status NVAPI_OK = 0;
constexpr NvU32 NVAPI_SHORT_STRING_MAX = 64;

using NvAPI_ShortString = char[NVAPI_SHORT_STRING_MAX];

#pragma pack(push, 8)
struct NV_DISPLAY_DVC_INFO_EX {
  NvU32 version;
  NvS32 currentLevel;
  NvS32 minLevel;
  NvS32 maxLevel;
  NvS32 defaultLevel;
};

struct NV_COLOR_DATA_V5 {
  NvU32 version;
  NvU16 size;
  NvU8 cmd;
  struct {
    NvU8 colorFormat;
    NvU8 colorimetry;
    NvU8 dynamicRange;
    NvS32 bpc;
    NvS32 colorSelectionPolicy;
    NvS32 depth;
  } data;
};
#pragma pack(pop)

static_assert(sizeof(NV_COLOR_DATA_V5) == 24,
              "NV_COLOR_DATA_V5 must match the NVAPI ABI.");

constexpr NvU32 MakeNvApiVersion(std::size_t structSize, NvU32 version) {
  return static_cast<NvU32>(structSize | (static_cast<std::size_t>(version) << 16));
}

constexpr NvU32 NV_DISPLAY_DVC_INFO_EX_VER =
    MakeNvApiVersion(sizeof(NV_DISPLAY_DVC_INFO_EX), 1);
constexpr NvU32 NV_COLOR_DATA_VER5 =
    MakeNvApiVersion(sizeof(NV_COLOR_DATA_V5), 5);

constexpr NvU8 NV_COLOR_CMD_GET = 1;
constexpr NvU8 NV_COLOR_CMD_SET = 2;
constexpr NvU8 NV_COLOR_CMD_IS_SUPPORTED_COLOR = 3;
constexpr NvU8 NV_DYNAMIC_RANGE_FULL = 0;
constexpr NvU8 NV_DYNAMIC_RANGE_LIMITED = 1;
constexpr NvU8 NV_DYNAMIC_RANGE_AUTO = 0xFF;
constexpr NvS32 NV_COLOR_SELECTION_POLICY_USER = 0;
constexpr NvS32 NV_COLOR_SELECTION_POLICY_BEST_QUALITY = 1;

using NvAPI_QueryInterface_t = void*(__cdecl*)(NvU32);
using NvAPI_Initialize_t = NvAPI_Status(__cdecl*)();
using NvAPI_Unload_t = NvAPI_Status(__cdecl*)();
using NvAPI_GetErrorMessage_t = NvAPI_Status(__cdecl*)(NvAPI_Status, NvAPI_ShortString);
using NvAPI_GetAssociatedNvidiaDisplayHandle_t =
    NvAPI_Status(__cdecl*)(const char*, NvDisplayHandle*);
using NvAPI_GetDVCInfoEx_t =
    NvAPI_Status(__cdecl*)(NvDisplayHandle, NvU32, NV_DISPLAY_DVC_INFO_EX*);
using NvAPI_SetDVCLevelEx_t =
    NvAPI_Status(__cdecl*)(NvDisplayHandle, NvU32, NV_DISPLAY_DVC_INFO_EX*);
using NvAPI_DISP_GetGDIPrimaryDisplayId_t =
    NvAPI_Status(__cdecl*)(NvU32*);
using NvAPI_Disp_ColorControl_t =
    NvAPI_Status(__cdecl*)(NvU32, NV_COLOR_DATA_V5*);

constexpr NvU32 NVAPI_ID_INITIALIZE = 0x0150E828;
constexpr NvU32 NVAPI_ID_UNLOAD = 0xD22BDD7E;
constexpr NvU32 NVAPI_ID_GET_ERROR_MESSAGE = 0x6C2D048C;
constexpr NvU32 NVAPI_ID_GET_ASSOCIATED_NVIDIA_DISPLAY_HANDLE = 0x35C29134;
constexpr NvU32 NVAPI_ID_GET_DVC_INFO_EX = 0x0E45002D;
constexpr NvU32 NVAPI_ID_SET_DVC_LEVEL_EX = 0x4A82C2B1;
constexpr NvU32 NVAPI_ID_DISP_GET_GDI_PRIMARY_DISPLAY_ID = 0x1E9D8A31;
constexpr NvU32 NVAPI_ID_DISP_COLOR_CONTROL = 0x92F9D80D;

template <typename T>
bool ResolveInterface(T& fn, NvAPI_QueryInterface_t query, NvU32 interfaceId,
                      const char* name, std::string& error) {
  fn = reinterpret_cast<T>(query(interfaceId));
  if (fn == nullptr) {
    error = std::string("NVAPI interface is unavailable: ") + name;
    return false;
  }
  return true;
}

std::string EscapeJson(std::string_view value) {
  std::string result;
  result.reserve(value.size());
  for (const char character : value) {
    switch (character) {
      case '\\':
        result += "\\\\";
        break;
      case '"':
        result += "\\\"";
        break;
      case '\n':
        result += "\\n";
        break;
      case '\r':
        result += "\\r";
        break;
      case '\t':
        result += "\\t";
        break;
      default:
        result += character;
        break;
    }
  }
  return result;
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
      error = "NVIDIA NVAPI library was not found.";
      return false;
    }

    query_ =
        reinterpret_cast<NvAPI_QueryInterface_t>(::GetProcAddress(module_, "nvapi_QueryInterface"));
    if (query_ == nullptr) {
      query_ = reinterpret_cast<NvAPI_QueryInterface_t>(
          ::GetProcAddress(module_, "nvapi_QueryInterface@4"));
    }
    if (query_ == nullptr) {
      error = "nvapi_QueryInterface was not found.";
      Shutdown();
      return false;
    }

    if (!ResolveInterface(initialize_, query_, NVAPI_ID_INITIALIZE, "NvAPI_Initialize", error) ||
        !ResolveInterface(unload_, query_, NVAPI_ID_UNLOAD, "NvAPI_Unload", error) ||
        !ResolveInterface(getErrorMessage_, query_, NVAPI_ID_GET_ERROR_MESSAGE,
                          "NvAPI_GetErrorMessage", error)) {
      Shutdown();
      return false;
    }

    const NvAPI_Status status = initialize_();
    if (status != NVAPI_OK) {
      error = std::string("NvAPI_Initialize failed: ") + StatusToString(status);
      Shutdown();
      return false;
    }
    initialized_ = true;
    return true;
  }

  bool LoadDigitalVibranceInterfaces(std::string& error) {
    return ResolveInterface(getAssociatedDisplay_, query_,
                            NVAPI_ID_GET_ASSOCIATED_NVIDIA_DISPLAY_HANDLE,
                            "NvAPI_GetAssociatedNvidiaDisplayHandle", error) &&
           ResolveInterface(getDvcInfo_, query_, NVAPI_ID_GET_DVC_INFO_EX,
                            "NvAPI_GetDVCInfoEx", error) &&
           ResolveInterface(setDvcLevel_, query_, NVAPI_ID_SET_DVC_LEVEL_EX,
                            "NvAPI_SetDVCLevelEx", error);
  }

  bool LoadColorControlInterfaces(std::string& error) {
    return ResolveInterface(getPrimaryDisplayId_, query_,
                            NVAPI_ID_DISP_GET_GDI_PRIMARY_DISPLAY_ID,
                            "NvAPI_DISP_GetGDIPrimaryDisplayId", error) &&
           ResolveInterface(colorControl_, query_, NVAPI_ID_DISP_COLOR_CONTROL,
                            "NvAPI_Disp_ColorControl", error);
  }

  void Shutdown() {
    if (initialized_ && unload_ != nullptr) {
      unload_();
    }
    initialized_ = false;
    query_ = nullptr;
    initialize_ = nullptr;
    unload_ = nullptr;
    getErrorMessage_ = nullptr;
    getAssociatedDisplay_ = nullptr;
    getDvcInfo_ = nullptr;
    setDvcLevel_ = nullptr;
    getPrimaryDisplayId_ = nullptr;
    colorControl_ = nullptr;
    if (module_ != nullptr) {
      ::FreeLibrary(module_);
      module_ = nullptr;
    }
  }

  std::string StatusToString(NvAPI_Status status) const {
    if (getErrorMessage_ != nullptr) {
      NvAPI_ShortString message{};
      if (getErrorMessage_(status, message) == NVAPI_OK && message[0] != '\0') {
        return message;
      }
    }
    return "status " + std::to_string(status);
  }

  NvAPI_Status GetAssociatedDisplay(const char* displayName,
                                    NvDisplayHandle* displayHandle) const {
    return getAssociatedDisplay_(displayName, displayHandle);
  }

  NvAPI_Status GetDvcInfo(NvDisplayHandle displayHandle,
                          NV_DISPLAY_DVC_INFO_EX* info) const {
    return getDvcInfo_(displayHandle, 0, info);
  }

  NvAPI_Status SetDvcLevel(NvDisplayHandle displayHandle,
                           NV_DISPLAY_DVC_INFO_EX* info) const {
    return setDvcLevel_(displayHandle, 0, info);
  }

  NvAPI_Status GetPrimaryDisplayId(NvU32* displayId) const {
    return getPrimaryDisplayId_(displayId);
  }

  NvAPI_Status ColorControl(NvU32 displayId,
                            NV_COLOR_DATA_V5* colorData) const {
    return colorControl_(displayId, colorData);
  }

 private:
  HMODULE module_ = nullptr;
  bool initialized_ = false;
  NvAPI_QueryInterface_t query_ = nullptr;
  NvAPI_Initialize_t initialize_ = nullptr;
  NvAPI_Unload_t unload_ = nullptr;
  NvAPI_GetErrorMessage_t getErrorMessage_ = nullptr;
  NvAPI_GetAssociatedNvidiaDisplayHandle_t getAssociatedDisplay_ = nullptr;
  NvAPI_GetDVCInfoEx_t getDvcInfo_ = nullptr;
  NvAPI_SetDVCLevelEx_t setDvcLevel_ = nullptr;
  NvAPI_DISP_GetGDIPrimaryDisplayId_t getPrimaryDisplayId_ = nullptr;
  NvAPI_Disp_ColorControl_t colorControl_ = nullptr;
};

bool ResolvePrimaryDisplayName(std::string& displayName, std::string& error) {
  for (DWORD index = 0;; ++index) {
    DISPLAY_DEVICEA device{};
    device.cb = sizeof(device);
    if (!::EnumDisplayDevicesA(nullptr, index, &device, 0)) {
      break;
    }
    const DWORD requiredFlags = DISPLAY_DEVICE_ACTIVE | DISPLAY_DEVICE_PRIMARY_DEVICE;
    if ((device.StateFlags & requiredFlags) == requiredFlags) {
      displayName = device.DeviceName;
      return true;
    }
  }
  error = "The active Windows primary display could not be resolved.";
  return false;
}

int ToPercent(const NV_DISPLAY_DVC_INFO_EX& info, NvS32 rawValue) {
  if (info.maxLevel <= info.minLevel) {
    return 0;
  }
  const double ratio =
      static_cast<double>(rawValue - info.minLevel) /
      static_cast<double>(info.maxLevel - info.minLevel);
  return std::clamp(static_cast<int>(std::lround(ratio * 100.0)), 0, 100);
}

NvS32 ToNativeLevel(const NV_DISPLAY_DVC_INFO_EX& info, int percent) {
  const double ratio = static_cast<double>(std::clamp(percent, 0, 100)) / 100.0;
  return static_cast<NvS32>(
      std::lround(info.minLevel + ratio * (info.maxLevel - info.minLevel)));
}

bool ParsePercent(const char* value, int& percent) {
  if (value == nullptr || *value == '\0') {
    return false;
  }
  char* end = nullptr;
  const long parsed = std::strtol(value, &end, 10);
  if (end == value || *end != '\0' || parsed < 0 || parsed > 100) {
    return false;
  }
  percent = static_cast<int>(parsed);
  return true;
}

bool ParseColorRange(std::string value, NvU8& dynamicRange) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char character) {
                   return static_cast<char>(std::tolower(character));
                 });
  if (value == "full") {
    dynamicRange = NV_DYNAMIC_RANGE_FULL;
    return true;
  }
  if (value == "limited") {
    dynamicRange = NV_DYNAMIC_RANGE_LIMITED;
    return true;
  }
  return false;
}

const char* ColorRangeName(const NV_COLOR_DATA_V5& colorData) {
  if (colorData.data.colorSelectionPolicy ==
      NV_COLOR_SELECTION_POLICY_BEST_QUALITY) {
    return "Auto";
  }
  switch (colorData.data.dynamicRange) {
    case NV_DYNAMIC_RANGE_FULL:
      return "Full";
    case NV_DYNAMIC_RANGE_LIMITED:
      return "Limited";
    case NV_DYNAMIC_RANGE_AUTO:
      return "Auto";
    default:
      return "Unknown";
  }
}

const char* ColorSelectionPolicyName(NvS32 policy) {
  switch (policy) {
    case NV_COLOR_SELECTION_POLICY_USER:
      return "User";
    case NV_COLOR_SELECTION_POLICY_BEST_QUALITY:
      return "BestQuality";
    default:
      return "Unknown";
  }
}

void PrintUsage() {
  std::cerr
      << "Usage:\n"
      << "  nvidia-display-helper get-digital-vibrance --display primary\n"
      << "  nvidia-display-helper set-digital-vibrance --display primary --value <0-100>\n"
      << "  nvidia-display-helper get-output-color-range --display primary\n"
      << "  nvidia-display-helper set-output-color-range --display primary "
         "--value <full|limited>\n";
}

void PrintResult(const std::string& displayName,
                 const NV_DISPLAY_DVC_INFO_EX& info) {
  std::cout << "{\"display\":\"" << EscapeJson(displayName)
            << "\",\"value\":" << ToPercent(info, info.currentLevel)
            << ",\"defaultValue\":" << ToPercent(info, info.defaultLevel)
            << ",\"native\":{\"current\":" << info.currentLevel
            << ",\"minimum\":" << info.minLevel
            << ",\"maximum\":" << info.maxLevel
            << ",\"default\":" << info.defaultLevel << "}}\n";
}

void PrintColorResult(const std::string& displayName, NvU32 displayId,
                      const NV_COLOR_DATA_V5& colorData) {
  std::cout << "{\"display\":\"" << EscapeJson(displayName)
            << "\",\"displayId\":" << displayId
            << ",\"value\":\"" << ColorRangeName(colorData)
            << "\",\"selectionPolicy\":\""
            << ColorSelectionPolicyName(colorData.data.colorSelectionPolicy)
            << "\",\"native\":{\"dynamicRange\":"
            << static_cast<unsigned int>(colorData.data.dynamicRange)
            << ",\"colorSelectionPolicy\":"
            << colorData.data.colorSelectionPolicy
            << ",\"colorFormat\":"
            << static_cast<unsigned int>(colorData.data.colorFormat)
            << ",\"colorimetry\":"
            << static_cast<unsigned int>(colorData.data.colorimetry)
            << ",\"bpc\":" << colorData.data.bpc
            << ",\"depth\":" << colorData.data.depth << "}}\n";
}

int main(int argc, char** argv) {
  if (argc < 2) {
    PrintUsage();
    return 2;
  }

  const std::string command = argv[1];
  const bool isDigitalVibranceCommand =
      command == "get-digital-vibrance" ||
      command == "set-digital-vibrance";
  const bool isColorRangeCommand =
      command == "get-output-color-range" ||
      command == "set-output-color-range";
  const bool isSetCommand =
      command == "set-digital-vibrance" ||
      command == "set-output-color-range";
  bool primaryDisplayRequested = false;
  bool valueProvided = false;
  std::string requestedValue;
  for (int index = 2; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--display" && index + 1 < argc) {
      primaryDisplayRequested = std::string(argv[++index]) == "primary";
    } else if (argument == "--value" && index + 1 < argc) {
      requestedValue = argv[++index];
      valueProvided = true;
    } else {
      PrintUsage();
      return 2;
    }
  }

  if (!primaryDisplayRequested ||
      (!isDigitalVibranceCommand && !isColorRangeCommand) ||
      (isSetCommand && !valueProvided) ||
      (!isSetCommand && valueProvided)) {
    PrintUsage();
    return 2;
  }

  int requestedPercent = -1;
  NvU8 requestedDynamicRange = NV_DYNAMIC_RANGE_FULL;
  if (command == "set-digital-vibrance" &&
      !ParsePercent(requestedValue.c_str(), requestedPercent)) {
    std::cerr
        << "Digital Vibrance value must be an integer from 0 through 100.\n";
    return 2;
  }
  if (command == "set-output-color-range") {
    if (!ParseColorRange(requestedValue, requestedDynamicRange)) {
      std::cerr
          << "Output color range must be full or limited. The NVIDIA "
             "driver's automatic BestQuality policy is read-only through "
             "this public NVAPI path.\n";
      return 2;
    }
  }

  std::string error;
  std::string displayName;
  if (!ResolvePrimaryDisplayName(displayName, error)) {
    std::cerr << error << '\n';
    return 3;
  }

  NvApi nvapi;
  if (!nvapi.Load(error)) {
    std::cerr << error << '\n';
    return 4;
  }

  if (isColorRangeCommand) {
    if (!nvapi.LoadColorControlInterfaces(error)) {
      std::cerr << error << '\n';
      return 5;
    }

    NvU32 displayId = 0;
    NvAPI_Status status = nvapi.GetPrimaryDisplayId(&displayId);
    if (status != NVAPI_OK || displayId == 0) {
      std::cerr << "The Windows primary display is not driven by NVIDIA: "
                << nvapi.StatusToString(status) << '\n';
      return 6;
    }

    NV_COLOR_DATA_V5 colorData{};
    colorData.version = NV_COLOR_DATA_VER5;
    colorData.size = static_cast<NvU16>(sizeof(colorData));
    colorData.cmd = NV_COLOR_CMD_GET;
    status = nvapi.ColorControl(displayId, &colorData);
    if (status != NVAPI_OK) {
      std::cerr << "Reading the NVIDIA output color range failed: "
                << nvapi.StatusToString(status) << '\n';
      return 7;
    }

    if (command == "set-output-color-range") {
      if (colorData.data.dynamicRange == requestedDynamicRange &&
          colorData.data.colorSelectionPolicy ==
              NV_COLOR_SELECTION_POLICY_USER) {
        PrintColorResult(displayName, displayId, colorData);
        return 0;
      }

      colorData.data.dynamicRange = requestedDynamicRange;
      colorData.data.colorSelectionPolicy =
          NV_COLOR_SELECTION_POLICY_USER;
      NV_COLOR_DATA_V5 supportQuery = colorData;
      supportQuery.cmd = NV_COLOR_CMD_IS_SUPPORTED_COLOR;
      status = nvapi.ColorControl(displayId, &supportQuery);
      if (status != NVAPI_OK) {
        std::cerr
            << "The requested NVIDIA output color configuration is not "
               "supported: "
            << nvapi.StatusToString(status) << '\n';
        return 8;
      }

      colorData.cmd = NV_COLOR_CMD_SET;
      status = nvapi.ColorControl(displayId, &colorData);
      if (status != NVAPI_OK) {
        std::cerr << "Setting the NVIDIA output color range failed: "
                  << nvapi.StatusToString(status) << '\n';
        return 9;
      }

      colorData = {};
      colorData.version = NV_COLOR_DATA_VER5;
      colorData.size = static_cast<NvU16>(sizeof(colorData));
      colorData.cmd = NV_COLOR_CMD_GET;
      status = nvapi.ColorControl(displayId, &colorData);
      if (status != NVAPI_OK) {
        std::cerr << "The NVIDIA output color range was set but verification "
                     "failed: "
                  << nvapi.StatusToString(status) << '\n';
        return 10;
      }

      if (colorData.data.dynamicRange != requestedDynamicRange ||
          colorData.data.colorSelectionPolicy !=
              NV_COLOR_SELECTION_POLICY_USER) {
        std::cerr
            << "The NVIDIA driver did not retain the requested output color "
               "range.\n";
        return 11;
      }
    }

    PrintColorResult(displayName, displayId, colorData);
    return 0;
  }

  if (!nvapi.LoadDigitalVibranceInterfaces(error)) {
    std::cerr << error << '\n';
    return 5;
  }

  NvDisplayHandle displayHandle = nullptr;
  NvAPI_Status status =
      nvapi.GetAssociatedDisplay(displayName.c_str(), &displayHandle);
  if (status != NVAPI_OK || displayHandle == nullptr) {
    std::cerr << "The Windows primary display is not driven by NVIDIA: "
              << nvapi.StatusToString(status) << '\n';
    return 5;
  }

  NV_DISPLAY_DVC_INFO_EX info{};
  info.version = NV_DISPLAY_DVC_INFO_EX_VER;
  status = nvapi.GetDvcInfo(displayHandle, &info);
  if (status != NVAPI_OK) {
    std::cerr << "Reading Digital Vibrance failed: "
              << nvapi.StatusToString(status) << '\n';
    return 6;
  }
  if (info.maxLevel <= info.minLevel) {
    std::cerr << "The NVIDIA driver returned an invalid Digital Vibrance range.\n";
    return 7;
  }

  if (command == "set-digital-vibrance") {
    info.currentLevel = ToNativeLevel(info, requestedPercent);
    status = nvapi.SetDvcLevel(displayHandle, &info);
    if (status != NVAPI_OK) {
      std::cerr << "Setting Digital Vibrance failed: "
                << nvapi.StatusToString(status) << '\n';
      return 8;
    }

    info = {};
    info.version = NV_DISPLAY_DVC_INFO_EX_VER;
    status = nvapi.GetDvcInfo(displayHandle, &info);
    if (status != NVAPI_OK) {
      std::cerr << "Digital Vibrance was set but verification failed: "
                << nvapi.StatusToString(status) << '\n';
      return 9;
    }
  }

  PrintResult(displayName, info);
  return 0;
}
