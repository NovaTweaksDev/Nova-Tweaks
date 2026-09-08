cmake_minimum_required(VERSION 3.20)
project(NovaPresentMonHelper LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(PRESENTMON_SDK_DIR "${CMAKE_CURRENT_LIST_DIR}/../../resources/tools/presentmon" CACHE PATH "Path to PresentMon Service/API SDK files")

add_executable(NovaPresentMonHelper
  src/main.cpp
)

target_include_directories(NovaPresentMonHelper PRIVATE
  "${PRESENTMON_SDK_DIR}"
)

target_compile_definitions(NovaPresentMonHelper PRIVATE
  _UNICODE
  UNICODE
  NOMINMAX
  WIN32_LEAN_AND_MEAN
)

target_link_libraries(NovaPresentMonHelper PRIVATE
  "${PRESENTMON_SDK_DIR}/PresentMonAPI2Loader.lib"
  delayimp
)

if(MSVC)
  set_property(TARGET NovaPresentMonHelper PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
  )
  target_compile_options(NovaPresentMonHelper PRIVATE /W4 /EHsc /permissive-)
  target_link_options(NovaPresentMonHelper PRIVATE /DELAYLOAD:PresentMonAPI2Loader.dll)
else()
  target_compile_options(NovaPresentMonHelper PRIVATE -Wall -Wextra -Wpedantic)
endif()
