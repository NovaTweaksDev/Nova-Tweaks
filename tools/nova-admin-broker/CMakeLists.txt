cmake_minimum_required(VERSION 3.20)
project(NovaAdminBrokerHost LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(NovaAdminBrokerHost src/main.cpp)
target_compile_definitions(NovaAdminBrokerHost PRIVATE _UNICODE UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_link_libraries(NovaAdminBrokerHost PRIVATE wintrust crypt32 advapi32)

if(MSVC)
  set_property(TARGET NovaAdminBrokerHost PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
  )
  target_compile_options(NovaAdminBrokerHost PRIVATE /W4 /EHsc /permissive-)
else()
  target_compile_options(NovaAdminBrokerHost PRIVATE -Wall -Wextra -Wpedantic)
endif()
