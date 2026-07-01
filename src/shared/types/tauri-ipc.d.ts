// Ambient shim for the Tauri `tauri::ipc::InvokeResponseBody` type that
// `cargo tauri-typegen generate` emits by name (e.g. `Channel<InvokeResponseBody>`)
// but cannot resolve to a concrete TS type. When the backend sends
// `InvokeResponseBody::Raw(Vec<u8>)` over an IPC channel, the JS `Channel`
// receives it as an `ArrayBuffer`, so that is the correct mapping here.
//
// This file is intentionally kept out of `src/generated/` so it survives
// regeneration of the typed bindings.
declare global {
	type InvokeResponseBody = ArrayBuffer;
}

export {};
