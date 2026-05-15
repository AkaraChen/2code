type ProjectAvatarCache = Record<string, string | null>;

const PROJECT_AVATAR_CACHE_KEY = "2code.project-avatar-cache";

let inMemoryCache: ProjectAvatarCache | null = null;

export function parseProjectAvatarCache(parsed: unknown): ProjectAvatarCache {
	const cache: ProjectAvatarCache = {};
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		return cache;
	}

	for (const key in parsed) {
		const value = parsed[key as keyof typeof parsed];
		if (typeof value === "string" || value === null) {
			cache[key] = value;
		}
	}

	return cache;
}

function readCacheFromStorage(): ProjectAvatarCache {
	if (inMemoryCache !== null) {
		return inMemoryCache;
	}

	inMemoryCache = {};

	try {
		const raw = localStorage.getItem(PROJECT_AVATAR_CACHE_KEY);
		if (!raw) {
			return inMemoryCache;
		}

		const parsed: unknown = JSON.parse(raw);
		inMemoryCache = parseProjectAvatarCache(parsed);
	} catch {
		inMemoryCache = {};
	}

	return inMemoryCache;
}

function writeCacheToStorage(cache: ProjectAvatarCache): void {
	try {
		localStorage.setItem(PROJECT_AVATAR_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// ignore localStorage failures in restricted environments
	}
}

export function getCachedProjectAvatar(
	projectId: string,
): string | null | undefined {
	return readCacheFromStorage()[projectId];
}

export function setCachedProjectAvatar(
	projectId: string,
	avatarUrl: string | null,
): void {
	const cache = readCacheFromStorage();
	cache[projectId] = avatarUrl;
	writeCacheToStorage(cache);
}

export function clearProjectAvatarCacheForTests(): void {
	inMemoryCache = {};
	writeCacheToStorage({});
}
