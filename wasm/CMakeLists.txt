cmake_minimum_required(VERSION 3.5.1)
project(q_wasm)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Add the WASM example
add_executable(pitch_detector_wasm 
    ../example/wasm_pitch_detect.cpp
)

target_include_directories(pitch_detector_wasm 
    PRIVATE 
    ${CMAKE_SOURCE_DIR}/../q_lib/include
    ${CMAKE_SOURCE_DIR}/../infra/include
)

# Emscripten link flags
set_target_properties(pitch_detector_wasm 
    PROPERTIES
    LINK_FLAGS "--bind -s WASM=1 -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap'] -s ALLOW_MEMORY_GROWTH=1 -s ASSERTIONS=1 -s NO_EXIT_RUNTIME=1 -s \"EXPORTED_FUNCTIONS=['_malloc', '_free']\" -s INITIAL_MEMORY=67108864"
)

# Disable building tests and examples from the main project
set(Q_BUILD_EXAMPLES OFF CACHE BOOL "")
set(Q_BUILD_TEST OFF CACHE BOOL "")
set(Q_BUILD_IO OFF CACHE BOOL "")
