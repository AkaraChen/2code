import { useQuery } from "@tanstack/react-query";
import { memo, useCallback } from "react";
import { FiChevronDown } from "react-icons/fi";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BrowserApp } from "@/generated";
import { listInstalledBrowsers, openUrlInBrowser } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import * as m from "@/paraglide/messages.js";

interface TerminalLinkConfirmDialogProps {
	link: string | null;
	onClose: () => void;
	onOpenDefault: () => void;
}

interface BrowserMenuItemProps {
	browser: BrowserApp;
	onOpen: (browserId: string) => void;
}

const BrowserMenuItem = memo(({
	browser,
	onOpen,
}: BrowserMenuItemProps) => {
	const handleClick = useCallback(() => {
		onOpen(browser.id);
	}, [browser.id, onOpen]);

	return (
		<DropdownMenuItem
			key={browser.id}
			onClick={handleClick}
		>
			{browser.name}
		</DropdownMenuItem>
	);
});

export function TerminalLinkConfirmDialog({
	link,
	onClose,
	onOpenDefault,
}: TerminalLinkConfirmDialogProps) {
	const { data: browsers = [] } = useQuery({
		queryKey: queryKeys.browser.installed,
		queryFn: listInstalledBrowsers,
		enabled: !!link,
		staleTime: 60_000,
	});

	const openWithBrowser = useCallback((browserId: string) => {
		if (!link) return;
		void openUrlInBrowser({ browserId, url: link });
		onClose();
	}, [link, onClose]);
	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) onClose();
		},
		[onClose],
	);

	return (
		<Dialog
			open={!!link}
			onOpenChange={handleOpenChange}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.terminalOpenLink()}</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-1">
					<p className="text-sm">{m.terminalOpenLinkConfirmDescription()}</p>
					<p className="mt-3 font-mono text-sm text-muted-foreground">
						{m.terminalOpenLinkUrlLabel()}
					</p>
					<p className="break-all font-mono text-sm">{link}</p>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{m.cancel()}
					</Button>
					<div className="flex">
						<Button
							className="rounded-r-none"
							onClick={onOpenDefault}
						>
							{m.browserOpenDefault()}
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										className="-ml-px rounded-l-none"
										size="icon"
										aria-label={m.browserOpenWith()}
										disabled={browsers.length === 0}
									/>
								}
							>
								<FiChevronDown />
							</DropdownMenuTrigger>
							<DropdownMenuContent className="min-w-52">
								{browsers.map((browser) => (
									<BrowserMenuItem
										key={browser.id}
										browser={browser}
										onOpen={openWithBrowser}
									/>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
