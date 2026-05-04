Write native bindings for the TypeScript definition TNativeModule in lib/native.ts.

The native bindings may only use napi and libuv, no other library, also no stdlib.
This native module should run on any platform, regardless of ABI.

The native module must compile without any warnings.

The output file must not link to any symbols other than napi or libuv, check with `objdump -t <binary>`
