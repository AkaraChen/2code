export function asError(error: unknown) {
	return error instanceof Error ? error : new Error(String(error));
}

export function getErrorMessage(error: unknown) {
	return asError(error).message;
}
