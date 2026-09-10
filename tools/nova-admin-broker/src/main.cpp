#include <windows.h>
#include <appmodel.h>
#include <sddl.h>
#include <wintrust.h>
#include <softpub.h>
#include <wincrypt.h>

#include <algorithm>
#include <cwctype>
#include <iostream>
#include <string>
#include <vector>

namespace {

std::wstring argumentValue(const std::vector<std::wstring>& arguments, const std::wstring& name) {
  const auto iterator = std::find(arguments.begin(), arguments.end(), name);
  if (iterator == arguments.end()) return L"";
  const auto value = std::next(iterator);
  return value == arguments.end() ? L"" : *value;
}

std::wstring quoteArgument(const std::wstring& value) {
  std::wstring result = L"\"";
  unsigned int backslashes = 0;
  for (const wchar_t character : value) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'\"') {
      result.append(backslashes * 2 + 1, L'\\');
      result.push_back(L'\"');
      backslashes = 0;
      continue;
    }
    result.append(backslashes, L'\\');
    backslashes = 0;
    result.push_back(character);
  }
  result.append(backslashes * 2, L'\\');
  result.push_back(L'\"');
  return result;
}

std::wstring canonicalPath(const std::wstring& input) {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetFullPathNameW(input.c_str(), static_cast<DWORD>(buffer.size()), buffer.data(), nullptr);
  if (length == 0 || length >= buffer.size()) return L"";
  std::wstring result(buffer.data(), length);
  std::transform(result.begin(), result.end(), result.begin(), [](const wchar_t value) { return std::towlower(value); });
  return result;
}

std::wstring processImagePath(const DWORD processId) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!process) return L"";
  std::vector<wchar_t> buffer(32768);
  DWORD size = static_cast<DWORD>(buffer.size());
  const BOOL success = QueryFullProcessImageNameW(process, 0, buffer.data(), &size);
  CloseHandle(process);
  return success ? std::wstring(buffer.data(), size) : L"";
}

std::wstring processUserSid(const DWORD processId) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!process) return L"";
  HANDLE token = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) {
    CloseHandle(process);
    return L"";
  }
  DWORD required = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &required);
  std::vector<unsigned char> buffer(required);
  std::wstring result;
  if (required > 0 && GetTokenInformation(token, TokenUser, buffer.data(), required, &required)) {
    const auto tokenUser = reinterpret_cast<const TOKEN_USER*>(buffer.data());
    wchar_t* sidText = nullptr;
    if (ConvertSidToStringSidW(tokenUser->User.Sid, &sidText)) {
      result = sidText;
      LocalFree(sidText);
    }
  }
  CloseHandle(token);
  CloseHandle(process);
  return result;
}

bool hasTrustedSignature(const std::wstring& filePath) {
  WINTRUST_FILE_INFO fileInfo{};
  fileInfo.cbStruct = sizeof(fileInfo);
  fileInfo.pcwszFilePath = filePath.c_str();

  WINTRUST_DATA trustData{};
  trustData.cbStruct = sizeof(trustData);
  trustData.dwUIChoice = WTD_UI_NONE;
  trustData.fdwRevocationChecks = WTD_REVOKE_NONE;
  trustData.dwUnionChoice = WTD_CHOICE_FILE;
  trustData.pFile = &fileInfo;
  trustData.dwStateAction = WTD_STATEACTION_VERIFY;
  trustData.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;

  GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
  const LONG result = WinVerifyTrust(nullptr, &policy, &trustData);
  trustData.dwStateAction = WTD_STATEACTION_CLOSE;
  WinVerifyTrust(nullptr, &policy, &trustData);
  return result == ERROR_SUCCESS;
}

std::wstring packageFullName(const DWORD processId) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!process) return L"";
  UINT32 length = 0;
  const LONG probe = GetPackageFullName(process, &length, nullptr);
  if (probe != ERROR_INSUFFICIENT_BUFFER || length == 0) {
    CloseHandle(process);
    return L"";
  }
  std::vector<wchar_t> packageName(length);
  const LONG result = GetPackageFullName(process, &length, packageName.data());
  CloseHandle(process);
  return result == ERROR_SUCCESS && length > 1 ? std::wstring(packageName.data()) : L"";
}

std::wstring currentPackageFullName() {
  UINT32 length = 0;
  const LONG probe = GetCurrentPackageFullName(&length, nullptr);
  if (probe != ERROR_INSUFFICIENT_BUFFER || length == 0) return L"";
  std::vector<wchar_t> packageName(length);
  return GetCurrentPackageFullName(&length, packageName.data()) == ERROR_SUCCESS
      ? std::wstring(packageName.data())
      : L"";
}

std::vector<unsigned char> signerCertificateHash(const std::wstring& filePath) {
  DWORD encoding = 0;
  DWORD contentType = 0;
  DWORD formatType = 0;
  HCERTSTORE store = nullptr;
  HCRYPTMSG message = nullptr;
  if (!CryptQueryObject(
          CERT_QUERY_OBJECT_FILE,
          filePath.c_str(),
          CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
          CERT_QUERY_FORMAT_FLAG_BINARY,
          0,
          &encoding,
          &contentType,
          &formatType,
          &store,
          &message,
          nullptr)) {
    return {};
  }

  DWORD signerSize = 0;
  if (!CryptMsgGetParam(message, CMSG_SIGNER_INFO_PARAM, 0, nullptr, &signerSize) || signerSize == 0) {
    CryptMsgClose(message);
    CertCloseStore(store, 0);
    return {};
  }
  std::vector<unsigned char> signerBuffer(signerSize);
  if (!CryptMsgGetParam(message, CMSG_SIGNER_INFO_PARAM, 0, signerBuffer.data(), &signerSize)) {
    CryptMsgClose(message);
    CertCloseStore(store, 0);
    return {};
  }
  const auto signer = reinterpret_cast<const CMSG_SIGNER_INFO*>(signerBuffer.data());
  CERT_INFO certificateInfo{};
  certificateInfo.Issuer = signer->Issuer;
  certificateInfo.SerialNumber = signer->SerialNumber;
  PCCERT_CONTEXT certificate = CertFindCertificateInStore(
      store,
      X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
      0,
      CERT_FIND_SUBJECT_CERT,
      &certificateInfo,
      nullptr);
  std::vector<unsigned char> hash;
  if (certificate) {
    DWORD hashSize = 0;
    if (CertGetCertificateContextProperty(certificate, CERT_SHA256_HASH_PROP_ID, nullptr, &hashSize) && hashSize > 0) {
      hash.resize(hashSize);
      if (!CertGetCertificateContextProperty(certificate, CERT_SHA256_HASH_PROP_ID, hash.data(), &hashSize)) hash.clear();
    }
    CertFreeCertificateContext(certificate);
  }
  CryptMsgClose(message);
  CertCloseStore(store, 0);
  return hash;
}

bool isTrustedParent(const DWORD parentPid, const std::wstring& parentPath, const bool allowUnsignedLocalTest) {
  const std::wstring parentPackage = packageFullName(parentPid);
  if (!parentPackage.empty()) {
    const std::wstring hostPackage = currentPackageFullName();
    return !hostPackage.empty() && _wcsicmp(parentPackage.c_str(), hostPackage.c_str()) == 0;
  }
  std::vector<wchar_t> hostPathBuffer(32768);
  const DWORD hostPathLength = GetModuleFileNameW(nullptr, hostPathBuffer.data(), static_cast<DWORD>(hostPathBuffer.size()));
  if (hostPathLength == 0 || hostPathLength >= hostPathBuffer.size()) return false;
  const std::wstring hostPath(hostPathBuffer.data(), hostPathLength);
  const bool hostIsSigned = hasTrustedSignature(hostPath);
  if (allowUnsignedLocalTest && !hostIsSigned) return true;
  if (!hasTrustedSignature(parentPath)) return false;
  if (!hostIsSigned) return false;
  const auto parentSigner = signerCertificateHash(parentPath);
  const auto hostSigner = signerCertificateHash(hostPath);
  return !parentSigner.empty() && parentSigner == hostSigner;
}

int fail(const wchar_t* message, const int code) {
  std::wcerr << message << L" (" << GetLastError() << L")\n";
  return code;
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  std::vector<std::wstring> arguments(argv + 1, argv + argc);
  const std::wstring pipeName = argumentValue(arguments, L"--pipe");
  const std::wstring workerPath = argumentValue(arguments, L"--worker");
  const std::wstring appPath = argumentValue(arguments, L"--app-path");
  const std::wstring session = argumentValue(arguments, L"--session");
  const std::wstring parentText = argumentValue(arguments, L"--parent-pid");
  const bool allowUnsignedLocalTest = std::find(
      arguments.begin(), arguments.end(), L"--allow-unsigned-local-test") != arguments.end();
  if (pipeName.empty() || workerPath.empty() || session.empty() || parentText.empty()) return fail(L"Missing broker arguments", 10);

  wchar_t* end = nullptr;
  const unsigned long parentPid = std::wcstoul(parentText.c_str(), &end, 10);
  if (!end || *end != L'\0' || parentPid == 0) return fail(L"Invalid parent process id", 11);
  const std::wstring parentPath = processImagePath(parentPid);
  if (parentPath.empty() || canonicalPath(parentPath) != canonicalPath(workerPath)) return fail(L"Broker parent identity mismatch", 12);
  if (!isTrustedParent(parentPid, parentPath, allowUnsignedLocalTest)) {
    return fail(L"Broker parent signature or package identity is invalid", 13);
  }
  const std::wstring originSid = processUserSid(parentPid);
  if (originSid.empty()) return fail(L"Unable to identify the originating user", 19);

  HANDLE pipe = INVALID_HANDLE_VALUE;
  for (int attempt = 0; attempt < 150; ++attempt) {
    pipe = CreateFileW(pipeName.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr);
    if (pipe != INVALID_HANDLE_VALUE) break;
    if (GetLastError() != ERROR_PIPE_BUSY && GetLastError() != ERROR_FILE_NOT_FOUND) return fail(L"Unable to connect to broker pipe", 14);
    WaitNamedPipeW(pipeName.c_str(), 200);
  }
  if (pipe == INVALID_HANDLE_VALUE) return fail(L"Broker pipe timed out", 15);

  ULONG serverPid = 0;
  if (!GetNamedPipeServerProcessId(pipe, &serverPid) || serverPid != parentPid) {
    CloseHandle(pipe);
    return fail(L"Broker pipe server identity mismatch", 16);
  }

  if (!SetHandleInformation(pipe, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
    CloseHandle(pipe);
    return fail(L"Unable to share the authenticated broker pipe", 17);
  }

  std::wstring commandLine = quoteArgument(workerPath);
  if (!appPath.empty()) commandLine += L" " + quoteArgument(appPath);
  commandLine += L" --nova-admin-broker-worker --broker-stdio --broker-session " + quoteArgument(session);
  commandLine += L" --broker-origin-sid " + quoteArgument(originSid);
  std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
  mutableCommand.push_back(L'\0');

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  startup.wShowWindow = SW_HIDE;
  startup.hStdInput = pipe;
  startup.hStdOutput = pipe;
  SECURITY_ATTRIBUTES inheritable{};
  inheritable.nLength = sizeof(inheritable);
  inheritable.bInheritHandle = TRUE;
  HANDLE nullError = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &inheritable, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  startup.hStdError = nullError == INVALID_HANDLE_VALUE ? pipe : nullError;
  PROCESS_INFORMATION process{};
  const BOOL created = CreateProcessW(
      workerPath.c_str(), mutableCommand.data(), nullptr, nullptr, TRUE,
      CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr, &startup, &process);
  SetHandleInformation(pipe, HANDLE_FLAG_INHERIT, 0);
  if (nullError != INVALID_HANDLE_VALUE) CloseHandle(nullError);
  if (!created) {
    CloseHandle(pipe);
    return fail(L"Unable to start administrator worker", 18);
  }

  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION jobLimits{};
  jobLimits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jobLimits, sizeof(jobLimits)) ||
      !AssignProcessToJobObject(job, process.hProcess)) {
    TerminateProcess(process.hProcess, 20);
    if (job) CloseHandle(job);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(pipe);
      return fail(L"Unable to contain administrator worker", 20);
  }
  if (ResumeThread(process.hThread) == static_cast<DWORD>(-1)) {
    TerminateProcess(process.hProcess, 21);
    CloseHandle(job);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(pipe);
    return fail(L"Unable to resume administrator worker", 21);
  }

  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exitCode = 1;
  GetExitCodeProcess(process.hProcess, &exitCode);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  CloseHandle(job);
  CloseHandle(pipe);
  return static_cast<int>(exitCode);
}
