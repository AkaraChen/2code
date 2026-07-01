import {
	type ChangeEvent,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { FiTrash2 } from "react-icons/fi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LogEntry } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import { useDebugLogStore } from "./debugLogStore";

function formatTime(timestamp: number): string {
	const d = new Date(timestamp);
	const h = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	const ms = String(d.getMilliseconds()).padStart(3, "0");
	return `${h}:${min}:${s}.${ms}`;
}

const levelVariant: Record<string, "default" | "destructive" | "secondary"> = {
	ERROR: "destructive",
	WARN: "secondary",
	INFO: "default",
};

const LogRow = memo(({ entry }: { entry: LogEntry }) => {
	return (
		<div className="flex items-baseline gap-2 px-3 py-0.5 font-mono text-xs hover:bg-muted">
			<span className="shrink-0 text-muted-foreground">
				{formatTime(entry.timestamp)}
			</span>
			<Badge
				variant={levelVariant[entry.level] ?? "secondary"}
				className="h-4 shrink-0 px-1.5"
			>
				{entry.level}
			</Badge>
			<span className="shrink-0 text-muted-foreground">{entry.source}</span>
			<span className="flex-1 break-all">{entry.message}</span>
		</div>
	);
});

interface DebugLogDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

function DebugLogContent() {
	const logs = useDebugLogStore((s) => s.logs);
	const clear = useDebugLogStore((s) => s.clear);
	const [search, setSearch] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const autoScrollRef = useRef(true);

	const filtered = useMemo(() => {
		if (!search) return logs;
		const lower = search.toLowerCase();
		return logs.filter(
			(e) =>
				e.message.toLowerCase().includes(lower) ||
				e.source.toLowerCase().includes(lower) ||
				e.level.toLowerCase().includes(lower),
		);
	}, [logs, search]);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		autoScrollRef.current = atBottom;
	}, []);
	const handleSearchChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			setSearch(event.target.value);
		},
		[],
	);
	useEffect(() => {
		if (autoScrollRef.current && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [filtered]);

	return (
		<>
			<div className="flex gap-2 px-4 pb-2">
				<Input
					placeholder={m.debugSearchPlaceholder()}
					value={search}
					onChange={handleSearchChange}
					className="flex-1"
				/>
				<Button
					aria-label={m.debugClear()}
					size="icon"
					variant="ghost"
					onClick={clear}
				>
					<FiTrash2 />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-hidden">
				<div
					ref={scrollRef}
					className="h-full overflow-y-auto"
					onScroll={handleScroll}
				>
					<div className="flex flex-col">
						{filtered.length === 0 ? (
							<div className="flex items-center justify-center py-8">
								<p className="text-sm text-muted-foreground">
									{m.debugNoLogs()}
								</p>
							</div>
						) : (
							filtered.map((entry) => (
								<LogRow key={entry.timestamp} entry={entry} />
							))
						)}
					</div>
				</div>
			</div>

			<div className="flex justify-end px-4 py-2">
				<p className="text-xs text-muted-foreground">
					{filtered.length} /{logs.length}
				</p>
			</div>
		</>
	);
}

export default function DebugLogDialog({
	isOpen,
	onClose,
}: DebugLogDialogProps) {
	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) onClose();
		},
		[onClose],
	);

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent className="flex max-h-[70vh] overflow-hidden sm:max-w-lg">
				<DialogHeader className="px-0">
					<DialogTitle>{m.debugLog()}</DialogTitle>
				</DialogHeader>
				<DebugLogContent />
			</DialogContent>
		</Dialog>
	);
}
