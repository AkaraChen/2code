// Stub for node:diagnostics_channel — the Node build of lru-cache (bundled
// into @xterm/addon-ligatures) statically imports this module. In a browser
// (Tauri) environment it doesn't exist, so we provide a no-op shim that
// matches lru-cache's own browser fallback ({ hasSubscribers: false }).

export function channel() {
	return {
		hasSubscribers: false,
		publish() {},
		subscribe() {},
		unsubscribe() {},
	};
}

export function tracingChannel() {
	return {
		hasSubscribers: false,
		tracePromise() {},
		start() {},
		asyncStart() {},
		asyncEnd() {},
		end() {},
		error() {},
		subscribe() {},
		unsubscribe() {},
	};
}
