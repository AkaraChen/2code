export function createCachedPromise<T>(fn: () => Promise<T>) {
	let promise: Promise<T> | null = null;
	return () => {
		if (!promise) promise = fn();
		return promise;
	};
}
