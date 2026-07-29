const platformString = `${navigator.platform} ${navigator.userAgent}`;

export function isMacPlatform() {
	return /mac/i.test(platformString);
}

export function isWindowsPlatform() {
	return /win/i.test(platformString);
}

export function isLinuxPlatform() {
	return /linux/i.test(platformString);
}
