# ![Q-Logo](docs/modules/ROOT/images/q-logo-small.png) Audio DSP Library

## Install 

- Install Emscripten from either:
   - [Emscripten](https://emscripten.org/docs/getting_started/downloads.html)
   - Build from source 
```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```


cd wasm/build
make clean
emcmake cmake -DCMAKE_BUILD_TYPE=Release ..
make