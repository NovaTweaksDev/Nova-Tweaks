cmake_minimum_required(VERSION 3.18)
project(nvidia_profile_helper LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(nvidia-profile-helper
  src/main.cpp
)

target_compile_definitions(nvidia-profile-helper PRIVATE _UNICODE UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_link_libraries(nvidia-profile-helper PRIVATE user32)

if(MSVC)
  set_property(TARGET nvidia-profile-helper PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
  )
  target_compile_options(nvidia-profile-helper PRIVATE /W4 /EHsc)
else()
  target_compile_options(nvidia-profile-helper PRIVATE -Wall -Wextra -Wpedantic)
endif()
