import { appendFrontendProfileEvents } from "@/generated";
import type { FrontendProfileEvent } from "@/generated/types";

const MAX_BUFFERED_EVENTS = 5000;
const FLUSH_THRESHOLD = 1000;
const FLUSH_INTERVAL_MS = 10_000;

let installed = false;
let flushing = false;
let buffer: FrontendProfileEvent[] = [];

function isEnabled() {
	return import.meta.env.DEV;
}

function addEvent(event: FrontendProfileEvent) {
	if (!isEnabled()) return;
	buffer.push(event);
	if (buffer.length > MAX_BUFFERED_EVENTS) {
		buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
	}
	if (buffer.length >= FLUSH_THRESHOLD) void flushPerformanceProfile();
}

function performanceEntryDetail(entry: PerformanceEntry) {
	const json = entry.toJSON() as Record<string, unknown>;
	delete json.name;
	delete json.entryType;
	delete json.startTime;
	delete json.duration;
	return JSON.stringify(json);
}

function addPerformanceEntry(entry: PerformanceEntry) {
	addEvent({
		name: entry.name,
		entry_type: entry.entryType,
		start_time: entry.startTime,
		duration: entry.duration,
		detail: performanceEntryDetail(entry),
	});
}

export function onReactRender(
	id: string,
	phase: "mount" | "update" | "nested-update",
	actualDuration: number,
	baseDuration: number,
	startTime: number,
	commitTime: number,
) {
	addEvent({
		name: id,
		entry_type: "react-render",
		start_time: startTime,
		duration: actualDuration,
		detail: JSON.stringify({
			phase,
			baseDuration,
			commitTime,
		}),
	});
}

export async function flushPerformanceProfile() {
	if (!isEnabled() || flushing || buffer.length === 0) return;
	flushing = true;
	const events = buffer;
	buffer = [];
	try {
		await appendFrontendProfileEvents({ events });
	} catch {
		buffer = events.concat(buffer).slice(-MAX_BUFFERED_EVENTS);
	} finally {
		flushing = false;
	}
}

export function installPerformanceProfile() {
	if (!isEnabled() || installed) return;
	installed = true;

	for (const entry of performance.getEntries()) {
		addPerformanceEntry(entry);
	}

	if ("PerformanceObserver" in window) {
		const types = PerformanceObserver.supportedEntryTypes.filter((type) =>
			["mark", "measure", "navigation", "paint", "resource", "longtask"].includes(type),
		);
		if (types.length > 0) {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) addPerformanceEntry(entry);
			});
			observer.observe({ entryTypes: types });
		}
	}

	window.addEventListener("beforeunload", () => {
		void flushPerformanceProfile();
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") void flushPerformanceProfile();
	});
	window.setInterval(() => {
		void flushPerformanceProfile();
	}, FLUSH_INTERVAL_MS);
}
