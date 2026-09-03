export function createCachedPromise<T>(fn: () => Promise<T>) {
	let promise: Promise<T> | null = null;
	return () => {
		if (!promise) {
			const nextPromise = fn().catch((error) => {
				if (promise === nextPromise) promise = null;
				throw error;
			});
			promise = nextPromise;
		}
		return promise;
	};
}
