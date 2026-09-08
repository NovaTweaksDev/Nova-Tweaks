cmake_minimum_required(VERSION 3.18)
project(nvidia_display_helper LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(nvidia-display-helper
  src/main.cpp
)

target_compile_definitions(nvidia-display-helper PRIVATE _UNICODE UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_link_libraries(nvidia-display-helper PRIVATE user32)

if(MSVC)
  target_compile_options(nvidia-display-helper PRIVATE /W4 /EHsc)
else()
  target_compile_options(nvidia-display-helper PRIVATE -Wall -Wextra -Wpedantic)
endif()
