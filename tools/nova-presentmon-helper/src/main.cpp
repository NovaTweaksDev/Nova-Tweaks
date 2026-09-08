#include <windows.h>
#include <tlhelp32.h>

#include <atomic>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "PresentMonAPI.h"

namespace {

constexpr int kExitOk = 0;
constexpr int kExitInvalidArgs = 2;
constexpr int kExitDllLoadFailed = 10;
constexpr int kExitServiceFailed = 11;
constexpr int kExitTrackingFailed = 12;
constexpr int kExitQueryFailed = 13;

constexpr std::uint32_t kDefaultPollMs = 500;
constexpr std::uint32_t kMinPollMs = 50;
constexpr std::uint32_t kRealtimeEtwFlushMs = 50;
constexpr std::uint32_t kMaxFramesPerPoll = 512;
constexpr std::uint32_t kMaxSwapChainsPerPoll = 16;
constexpr std::uint32_t kNoDataStatusAfterEmptyPolls = 10;

std::atomic_bool g_running{true};

struct Options {
  std::uint32_t targetPid = 0;
  std::string targetProcessName;
  std::uint32_t pollMs = kDefaultPollMs;
  std::filesystem::path presentMonPath;
};

struct TargetProcess {
  std::uint32_t pid = 0;
  std::string processName;
};

struct FrameOffsets {
  std::uint64_t cpuFrameTimeMs = 0;
};

struct DynamicOffsets {
  std::uint64_t fps = 0;
  std::uint64_t displayedFps = 0;
  std::uint64_t presentedFps = 0;
  std::uint64_t frameTimeMs = 0;
  std::uint64_t blobSize = 0;
};

std::string WideToUtf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }

  const int size = ::WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) {
    return {};
  }

  std::string output(static_cast<std::size_t>(size), '\0');
  ::WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), output.data(), size, nullptr, nullptr);
  return output;
}

std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return {};
  }

  const int size = ::MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) {
    return {};
  }

  std::wstring output(static_cast<std::size_t>(size), L'\0');
  ::MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), output.data(), size);
  return output;
}

std::string JsonEscape(std::string_view value) {
  std::ostringstream out;
  for (const unsigned char ch : value) {
    switch (ch) {
      case '\\':
        out << "\\\\";
        break;
      case '"':
        out << "\\\"";
        break;
      case '\b':
        out << "\\b";
        break;
      case '\f':
        out << "\\f";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        if (ch < 0x20) {
          out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(ch)
              << std::dec << std::setfill(' ');
        } else {
          out << static_cast<char>(ch);
        }
        break;
    }
  }
  return out.str();
}

void EmitJsonLine(const std::string& json) {
  std::cout << json << '\n';
  std::cout.flush();
}

void EmitStatus(std::string_view status) {
  std::ostringstream out;
  out << "{\"type\":\"status\",\"status\":\"" << JsonEscape(status) << "\"}";
  EmitJsonLine(out.str());
}

void EmitStatusMessage(std::string_view status, std::string_view message) {
  std::ostringstream out;
  out << "{\"type\":\"status\",\"status\":\"" << JsonEscape(status) << "\","
      << "\"message\":\"" << JsonEscape(message) << "\"}";
  EmitJsonLine(out.str());
}

void EmitConnectedStatus(const TargetProcess& target, const PM_VERSION& apiVersion) {
  std::ostringstream out;
  out << "{\"type\":\"status\",\"status\":\"connected\","
      << "\"pid\":" << target.pid << ','
      << "\"processName\":\"" << JsonEscape(target.processName) << "\","
      << "\"apiVersion\":\"" << apiVersion.major << '.' << apiVersion.minor << '.' << apiVersion.patch;
  if (apiVersion.tag[0] != '\0') {
    out << '-' << JsonEscape(apiVersion.tag);
  }
  out << "\"}";
  EmitJsonLine(out.str());
}

void EmitError(std::string_view message) {
  std::ostringstream out;
  out << "{\"type\":\"error\",\"message\":\"" << JsonEscape(message) << "\"}";
  EmitJsonLine(out.str());
}

void EmitMetrics(const TargetProcess& target, double fps, double frameTimeMs) {
  std::ostringstream out;
  out << std::fixed << std::setprecision(3);
  out << "{\"type\":\"metrics\","
      << "\"pid\":" << target.pid << ','
      << "\"processName\":\"" << JsonEscape(target.processName) << "\","
      << "\"fps\":" << fps << ','
      << "\"frameTimeMs\":" << frameTimeMs
      << "}";
  EmitJsonLine(out.str());
}

std::string StatusToString(PM_STATUS status) {
  switch (status) {
    case PM_STATUS_SUCCESS:
      return "PM_STATUS_SUCCESS";
    case PM_STATUS_FAILURE:
      return "PM_STATUS_FAILURE";
    case PM_STATUS_BAD_ARGUMENT:
      return "PM_STATUS_BAD_ARGUMENT";
    case PM_STATUS_BAD_HANDLE:
      return "PM_STATUS_BAD_HANDLE";
    case PM_STATUS_SERVICE_ERROR:
      return "PM_STATUS_SERVICE_ERROR";
    case PM_STATUS_INVALID_ETL_FILE:
      return "PM_STATUS_INVALID_ETL_FILE";
    case PM_STATUS_INVALID_PID:
      return "PM_STATUS_INVALID_PID";
    case PM_STATUS_ALREADY_TRACKING_PROCESS:
      return "PM_STATUS_ALREADY_TRACKING_PROCESS";
    case PM_STATUS_UNABLE_TO_CREATE_NSM:
      return "PM_STATUS_UNABLE_TO_CREATE_NSM";
    case PM_STATUS_INVALID_ADAPTER_ID:
      return "PM_STATUS_INVALID_ADAPTER_ID";
    case PM_STATUS_OUT_OF_RANGE:
      return "PM_STATUS_OUT_OF_RANGE";
    case PM_STATUS_INSUFFICIENT_BUFFER:
      return "PM_STATUS_INSUFFICIENT_BUFFER";
    case PM_STATUS_PIPE_ERROR:
      return "PM_STATUS_PIPE_ERROR";
    case PM_STATUS_SESSION_NOT_OPEN:
      return "PM_STATUS_SESSION_NOT_OPEN";
    case PM_STATUS_MIDDLEWARE_MISSING_PATH:
      return "PM_STATUS_MIDDLEWARE_MISSING_PATH";
    case PM_STATUS_NONEXISTENT_FILE_PATH:
      return "PM_STATUS_NONEXISTENT_FILE_PATH";
    case PM_STATUS_MIDDLEWARE_INVALID_SIGNATURE:
      return "PM_STATUS_MIDDLEWARE_INVALID_SIGNATURE";
    case PM_STATUS_MIDDLEWARE_MISSING_ENDPOINT:
      return "PM_STATUS_MIDDLEWARE_MISSING_ENDPOINT";
    case PM_STATUS_MIDDLEWARE_VERSION_LOW:
      return "PM_STATUS_MIDDLEWARE_VERSION_LOW";
    case PM_STATUS_MIDDLEWARE_VERSION_HIGH:
      return "PM_STATUS_MIDDLEWARE_VERSION_HIGH";
    case PM_STATUS_MIDDLEWARE_SERVICE_MISMATCH:
      return "PM_STATUS_MIDDLEWARE_SERVICE_MISMATCH";
    default:
      return "PM_STATUS_" + std::to_string(static_cast<int>(status));
  }
}

bool CaseInsensitiveEquals(std::wstring_view left, std::wstring_view right) {
  if (left.size() != right.size()) {
    return false;
  }

  return ::CompareStringOrdinal(left.data(), static_cast<int>(left.size()), right.data(), static_cast<int>(right.size()), TRUE) == CSTR_EQUAL;
}

std::optional<TargetProcess> FindProcessByName(const std::string& processName) {
  const std::wstring wanted = Utf8ToWide(processName);
  if (wanted.empty()) {
    return std::nullopt;
  }

  HANDLE snapshot = ::CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return std::nullopt;
  }

  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);

  std::optional<TargetProcess> result;
  if (::Process32FirstW(snapshot, &entry)) {
    do {
      if (CaseInsensitiveEquals(entry.szExeFile, wanted)) {
        result = TargetProcess{
            static_cast<std::uint32_t>(entry.th32ProcessID),
            WideToUtf8(entry.szExeFile),
        };
        break;
      }
    } while (::Process32NextW(snapshot, &entry));
  }

  ::CloseHandle(snapshot);
  return result;
}

std::optional<std::string> GetProcessNameByPid(std::uint32_t pid) {
  HANDLE snapshot = ::CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return std::nullopt;
  }

  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);

  std::optional<std::string> result;
  if (::Process32FirstW(snapshot, &entry)) {
    do {
      if (entry.th32ProcessID == pid) {
        result = WideToUtf8(entry.szExeFile);
        break;
      }
    } while (::Process32NextW(snapshot, &entry));
  }

  ::CloseHandle(snapshot);
  return result;
}

bool IsProcessRunning(std::uint32_t pid) {
  HANDLE process = ::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (process == nullptr) {
    return false;
  }

  DWORD exitCode = 0;
  const bool running = ::GetExitCodeProcess(process, &exitCode) && exitCode == STILL_ACTIVE;
  ::CloseHandle(process);
  return running;
}

bool ParseUint32(std::string_view value, std::uint32_t& output) {
  if (value.empty()) {
    return false;
  }

  std::uint64_t parsed = 0;
  for (const char ch : value) {
    if (ch < '0' || ch > '9') {
      return false;
    }
    parsed = parsed * 10 + static_cast<std::uint64_t>(ch - '0');
    if (parsed > UINT32_MAX) {
      return false;
    }
  }

  output = static_cast<std::uint32_t>(parsed);
  return true;
}

bool ParseArgs(int argc, char** argv, Options& options, std::string& error) {
  for (int i = 1; i < argc; ++i) {
    const std::string_view arg(argv[i]);
    auto readValue = [&](std::string_view name) -> std::optional<std::string> {
      if (i + 1 >= argc) {
        error = std::string(name) + " requires a value.";
        return std::nullopt;
      }
      ++i;
      return std::string(argv[i]);
    };

    if (arg == "--target-process-name") {
      auto value = readValue(arg);
      if (!value) return false;
      options.targetProcessName = *value;
    } else if (arg == "--target-pid") {
      auto value = readValue(arg);
      if (!value) return false;
      if (!ParseUint32(*value, options.targetPid) || options.targetPid == 0) {
        error = "--target-pid must be a positive integer.";
        return false;
      }
    } else if (arg == "--poll-ms") {
      auto value = readValue(arg);
      if (!value) return false;
      if (!ParseUint32(*value, options.pollMs) || options.pollMs < kMinPollMs) {
        error = "--poll-ms must be an integer greater than or equal to 50.";
        return false;
      }
    } else if (arg == "--presentmon-path") {
      auto value = readValue(arg);
      if (!value) return false;
      options.presentMonPath = Utf8ToWide(*value);
    } else if (arg == "--help" || arg == "-h" || arg == "/?") {
      error = "usage";
      return false;
    } else {
      error = "Unknown argument: " + std::string(arg);
      return false;
    }
  }

  if (options.targetPid == 0 && options.targetProcessName.empty()) {
    error = "Specify --target-pid <pid> or --target-process-name <exe>.";
    return false;
  }

  return true;
}

void PrintUsage() {
  std::cerr << "Usage:\n";
  std::cerr << "  NovaPresentMonHelper.exe --target-process-name FortniteClient-Win64-Shipping.exe --poll-ms 500 [--presentmon-path <path>]\n";
  std::cerr << "  NovaPresentMonHelper.exe --target-pid 20252 --poll-ms 500 [--presentmon-path <path>]\n";
}

BOOL WINAPI ConsoleHandler(DWORD controlType) {
  switch (controlType) {
    case CTRL_C_EVENT:
    case CTRL_BREAK_EVENT:
    case CTRL_CLOSE_EVENT:
    case CTRL_SHUTDOWN_EVENT:
      g_running.store(false);
      return TRUE;
    default:
      return FALSE;
  }
}

std::filesystem::path GetExecutableDirectory() {
  std::wstring buffer(MAX_PATH, L'\0');
  DWORD size = ::GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  while (size == buffer.size()) {
    buffer.resize(buffer.size() * 2);
    size = ::GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  }

  if (size == 0) {
    return std::filesystem::current_path();
  }

  buffer.resize(size);
  return std::filesystem::path(buffer).parent_path();
}

class PresentMonDll {
 public:
  ~PresentMonDll() {
    if (module_ != nullptr) {
      ::FreeLibrary(module_);
      module_ = nullptr;
    }
  }

  bool Load(const std::filesystem::path& presentMonPath, std::string& error) {
    std::vector<std::filesystem::path> candidates;
    if (!presentMonPath.empty()) {
      candidates.push_back(presentMonPath / L"PresentMonAPI2Loader.dll");
    }
    candidates.push_back(GetExecutableDirectory() / L"PresentMonAPI2Loader.dll");
    candidates.emplace_back(L"PresentMonAPI2Loader.dll");

    for (const auto& candidate : candidates) {
      module_ = ::LoadLibraryW(candidate.c_str());
      if (module_ != nullptr) {
        return true;
      }
    }

    error = "Unable to load PresentMonAPI2Loader.dll. Pass --presentmon-path pointing to resources/tools/presentmon.";
    return false;
  }

 private:
  HMODULE module_ = nullptr;
};

class SessionGuard {
 public:
  ~SessionGuard() {
    if (dynamicQuery_ != nullptr) {
      (void)pmFreeDynamicQuery(dynamicQuery_);
      dynamicQuery_ = nullptr;
    }
    if (frameQuery_ != nullptr) {
      (void)pmFreeFrameQuery(frameQuery_);
      frameQuery_ = nullptr;
    }
    if (session_ != nullptr) {
      if (trackedPid_ != 0) {
        (void)pmStopTrackingProcess(session_, trackedPid_);
      }
      (void)pmCloseSession(session_);
      session_ = nullptr;
    }
  }

  PM_SESSION_HANDLE* PutSession() { return &session_; }
  PM_SESSION_HANDLE Session() const { return session_; }

  PM_FRAME_QUERY_HANDLE* PutFrameQuery() { return &frameQuery_; }
  PM_FRAME_QUERY_HANDLE FrameQuery() const { return frameQuery_; }

  PM_DYNAMIC_QUERY_HANDLE* PutDynamicQuery() { return &dynamicQuery_; }
  PM_DYNAMIC_QUERY_HANDLE DynamicQuery() const { return dynamicQuery_; }

  void SetTrackedPid(std::uint32_t pid) { trackedPid_ = pid; }

 private:
  PM_SESSION_HANDLE session_ = nullptr;
  PM_FRAME_QUERY_HANDLE frameQuery_ = nullptr;
  PM_DYNAMIC_QUERY_HANDLE dynamicQuery_ = nullptr;
  std::uint32_t trackedPid_ = 0;
};

template <typename T>
T ReadBlobValue(const std::vector<std::uint8_t>& blobs, std::uint32_t blobSize, std::uint32_t index, std::uint64_t offset) {
  T value{};
  const std::size_t position = static_cast<std::size_t>(index) * blobSize + static_cast<std::size_t>(offset);
  if (position + sizeof(T) <= blobs.size()) {
    std::memcpy(&value, blobs.data() + position, sizeof(T));
  }
  return value;
}

double PickFrameTimeMs(double displayedFrameTimeMs, double presentedFrameTimeMs, double betweenPresentsMs, double betweenAppStartMs) {
  for (const double value : {displayedFrameTimeMs, presentedFrameTimeMs, betweenPresentsMs, betweenAppStartMs}) {
    if (std::isfinite(value) && value > 0.0 && value < 10000.0) {
      return value;
    }
  }
  return 0.0;
}

std::uint64_t BlobSizeFromElements(const std::vector<PM_QUERY_ELEMENT>& elements) {
  std::uint64_t blobSize = 0;
  for (const auto& element : elements) {
    blobSize = std::max(blobSize, element.dataOffset + element.dataSize);
  }
  return blobSize;
}

double PickFps(double appFps, double displayedFps, double presentedFps, double frameTimeMs) {
  for (const double value : {appFps, displayedFps, presentedFps}) {
    if (std::isfinite(value) && value > 0.0 && value < 10000.0) {
      return value;
    }
  }
  return frameTimeMs > 0.0 ? 1000.0 / frameTimeMs : 0.0;
}

bool RegisterDynamicQuery(SessionGuard& session, DynamicOffsets& offsets, std::string& error) {
  auto makeElement = [](PM_METRIC metric, PM_STAT stat) {
    PM_QUERY_ELEMENT element{};
    element.metric = metric;
    element.stat = stat;
    element.deviceId = 0;
    element.arrayIndex = 0;
    return element;
  };

  std::vector<PM_QUERY_ELEMENT> queryElements;
  queryElements.push_back(makeElement(PM_METRIC_APPLICATION_FPS, PM_STAT_AVG));
  queryElements.push_back(makeElement(PM_METRIC_DISPLAYED_FPS, PM_STAT_AVG));
  queryElements.push_back(makeElement(PM_METRIC_PRESENTED_FPS, PM_STAT_AVG));
  queryElements.push_back(makeElement(PM_METRIC_CPU_FRAME_TIME, PM_STAT_AVG));

  const PM_STATUS status = pmRegisterDynamicQuery(
      session.Session(),
      session.PutDynamicQuery(),
      queryElements.data(),
      queryElements.size(),
      1000.0,
      0.0);
  if (status != PM_STATUS_SUCCESS) {
    error = "pmRegisterDynamicQuery failed: " + StatusToString(status);
    return false;
  }

  offsets.fps = queryElements[0].dataOffset;
  offsets.displayedFps = queryElements[1].dataOffset;
  offsets.presentedFps = queryElements[2].dataOffset;
  offsets.frameTimeMs = queryElements[3].dataOffset;
  offsets.blobSize = BlobSizeFromElements(queryElements);
  if (offsets.blobSize == 0) {
    error = "pmRegisterDynamicQuery returned a zero-sized metric blob.";
    return false;
  }

  return true;
}

bool PollDynamicMetrics(SessionGuard& session, const DynamicOffsets& offsets, const TargetProcess& target) {
  std::uint32_t swapChains = kMaxSwapChainsPerPoll;
  std::vector<std::uint8_t> blobs(static_cast<std::size_t>(offsets.blobSize) * swapChains);

  const PM_STATUS status = pmPollDynamicQuery(session.DynamicQuery(), target.pid, blobs.data(), &swapChains);
  if (status != PM_STATUS_SUCCESS || swapChains == 0) {
    return false;
  }

  double bestFps = 0.0;
  double bestFrameTimeMs = 0.0;
  for (std::uint32_t i = 0; i < swapChains; ++i) {
    const double frameTimeMs = ReadBlobValue<double>(
        blobs, static_cast<std::uint32_t>(offsets.blobSize), i, offsets.frameTimeMs);
    const double fps = PickFps(
        ReadBlobValue<double>(blobs, static_cast<std::uint32_t>(offsets.blobSize), i, offsets.fps),
        ReadBlobValue<double>(blobs, static_cast<std::uint32_t>(offsets.blobSize), i, offsets.displayedFps),
        ReadBlobValue<double>(blobs, static_cast<std::uint32_t>(offsets.blobSize), i, offsets.presentedFps),
        frameTimeMs);

    if (fps > bestFps) {
      bestFps = fps;
      bestFrameTimeMs = frameTimeMs > 0.0 ? frameTimeMs : 1000.0 / fps;
    }
  }

  if (bestFps <= 0.0 || bestFrameTimeMs <= 0.0) {
    return false;
  }

  EmitMetrics(target, bestFps, bestFrameTimeMs);
  return true;
}

int Run(const Options& options) {
  // The service owns ETW capture; clients need not hold trace privileges.
  // Let the API report actual connection or tracking failures.
  TargetProcess target;
  if (options.targetPid != 0) {
    target.pid = options.targetPid;
    target.processName = GetProcessNameByPid(options.targetPid).value_or(options.targetProcessName);
    if (target.processName.empty()) {
      target.processName = "pid-" + std::to_string(options.targetPid);
    }
  } else {
    const auto resolved = FindProcessByName(options.targetProcessName);
    if (!resolved) {
      EmitError("Target process is not running: " + options.targetProcessName);
      return kExitInvalidArgs;
    }
    target = *resolved;
  }

  PresentMonDll presentMonDll;
  std::string loadError;
  if (!presentMonDll.Load(options.presentMonPath, loadError)) {
    EmitError(loadError);
    return kExitDllLoadFailed;
  }

  PM_VERSION apiVersion{};
  PM_STATUS status = pmGetApiVersion(&apiVersion);
  if (status != PM_STATUS_SUCCESS) {
    EmitError("pmGetApiVersion failed: " + StatusToString(status));
    return kExitDllLoadFailed;
  }

  SessionGuard session;
  status = pmOpenSession(session.PutSession());
  if (status != PM_STATUS_SUCCESS) {
    EmitError("pmOpenSession failed. PresentMon Service may be unavailable: " + StatusToString(status));
    return kExitServiceFailed;
  }

  status = pmSetEtwFlushPeriod(session.Session(), kRealtimeEtwFlushMs);
  if (status != PM_STATUS_SUCCESS) {
    EmitError("pmSetEtwFlushPeriod failed: " + StatusToString(status));
    return kExitServiceFailed;
  }

  status = pmStartTrackingProcess(session.Session(), target.pid);
  if (status != PM_STATUS_SUCCESS && status != PM_STATUS_ALREADY_TRACKING_PROCESS) {
    EmitError("pmStartTrackingProcess failed for PID " + std::to_string(target.pid) + ": " + StatusToString(status));
    return kExitTrackingFailed;
  }
  session.SetTrackedPid(target.pid);

  EmitConnectedStatus(target, apiVersion);

  FrameOffsets offsets{};
  auto makeElement = [](PM_METRIC metric) {
    PM_QUERY_ELEMENT element{};
    element.metric = metric;
    element.stat = PM_STAT_NONE;
    element.deviceId = 0;
    element.arrayIndex = 0;
    return element;
  };

  std::vector<PM_QUERY_ELEMENT> queryElements;
  queryElements.push_back(makeElement(PM_METRIC_CPU_FRAME_TIME));

  std::uint32_t blobSize = 0;
  status = pmRegisterFrameQuery(session.Session(), session.PutFrameQuery(), queryElements.data(), queryElements.size(), &blobSize);
  if (status != PM_STATUS_SUCCESS) {
    EmitError("pmRegisterFrameQuery failed: " + StatusToString(status));
    return kExitQueryFailed;
  }

  if (blobSize == 0) {
    EmitError("pmRegisterFrameQuery returned a zero-sized frame blob.");
    return kExitQueryFailed;
  }

  offsets.cpuFrameTimeMs = queryElements[0].dataOffset;

  DynamicOffsets dynamicOffsets{};
  std::string dynamicQueryError;
  const bool dynamicQueryAvailable = RegisterDynamicQuery(session, dynamicOffsets, dynamicQueryError);
  if (!dynamicQueryAvailable) {
    EmitStatusMessage("dynamic_query_unavailable", dynamicQueryError);
  }

  std::uint32_t emptyPolls = 0;
  while (g_running.load()) {
    if (!IsProcessRunning(target.pid)) {
      EmitError("Target process exited.");
      break;
    }

    std::uint32_t framesToRead = kMaxFramesPerPoll;
    std::vector<std::uint8_t> blobs(static_cast<std::size_t>(blobSize) * framesToRead);
    status = pmConsumeFrames(session.FrameQuery(), target.pid, blobs.data(), &framesToRead);
    if (status != PM_STATUS_SUCCESS) {
      EmitError("pmConsumeFrames failed: " + StatusToString(status));
      break;
    }

    double latestFrameTimeMs = 0.0;
    for (std::uint32_t i = 0; i < framesToRead; ++i) {
      const double cpuFrameTimeMs = ReadBlobValue<double>(blobs, blobSize, i, offsets.cpuFrameTimeMs);
      const double frameTimeMs = PickFrameTimeMs(cpuFrameTimeMs, 0.0, 0.0, 0.0);
      if (frameTimeMs > 0.0) {
        latestFrameTimeMs = frameTimeMs;
      }
    }

    bool emittedMetric = false;
    if (latestFrameTimeMs > 0.0) {
      EmitMetrics(target, 1000.0 / latestFrameTimeMs, latestFrameTimeMs);
      emittedMetric = true;
    } else if (dynamicQueryAvailable) {
      emittedMetric = PollDynamicMetrics(session, dynamicOffsets, target);
    }

    if (emittedMetric) {
      emptyPolls = 0;
    } else {
      emptyPolls += 1;
      if (emptyPolls == kNoDataStatusAfterEmptyPolls) {
        EmitStatusMessage("no_data", "PresentMon is connected and tracking the target process, but no frame metrics have arrived yet.");
      }
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(options.pollMs));
  }

  return kExitOk;
}

}  // namespace

int main(int argc, char** argv) {
  ::SetConsoleCtrlHandler(ConsoleHandler, TRUE);
  EmitStatus("starting");

  Options options;
  std::string error;
  if (!ParseArgs(argc, argv, options, error)) {
    if (error == "usage") {
      PrintUsage();
      return kExitInvalidArgs;
    }

    EmitError(error);
    PrintUsage();
    return kExitInvalidArgs;
  }

  return Run(options);
}
