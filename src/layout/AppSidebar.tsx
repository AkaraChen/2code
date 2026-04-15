import "@fontsource-variable/bricolage-grotesque";
import { Box, Flex, HStack, IconButton, Text } from "@chakra-ui/react";
import { LayoutGroup } from "motion/react";
import { useCallback, useRef } from "react";
import { FiHome, FiPlus, FiSettings } from "react-icons/fi";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";
import { useProjects } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";
import { SidebarLink } from "@/shared/components/SidebarLink";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { useHorizontalResize } from "@/shared/hooks/useHorizontalResize";
import { ProjectMenuItem } from "./sidebar/ProjectMenuItem";
import {
	APP_SIDEBAR_MAX_WIDTH,
	APP_SIDEBAR_MIN_WIDTH,
	useAppSidebarStore,
} from "./sidebarStore";

export default function AppSidebar() {
	const { data: projects } = useProjects();
	const createDialog = useDialogState();
	const navRef = useRef<HTMLElement>(null);
	const sidebarWidth = useAppSidebarStore((s) => s.width);
	const setSidebarWidth = useAppSidebarStore((s) => s.setWidth);
	const resize = useHorizontalResize({
		value: sidebarWidth,
		min: APP_SIDEBAR_MIN_WIDTH,
		max: APP_SIDEBAR_MAX_WIDTH,
		onChange: setSidebarWidth,
	});

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

		const nav = navRef.current;
		if (!nav) return;

		const items = Array.from(
			nav.querySelectorAll<HTMLElement>("[data-sidebar-item]"),
		);
		if (items.length === 0) return;

		const currentIndex = items.indexOf(document.activeElement as HTMLElement);

		let nextIndex: number;
		if (e.key === "ArrowDown") {
			nextIndex =
				currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
		} else {
			nextIndex =
				currentIndex === -1
					? items.length - 1
					: (currentIndex - 1 + items.length) % items.length;
		}

		items[nextIndex]?.focus();
		e.preventDefault();
	}, []);

	return (
		<>
			<Box
				as="nav"
				ref={navRef}
				aria-label={m.sideNavLabel()}
				w="var(--sidebar-width)"
				h="full"
				flexShrink={0}
				position="relative"
				bg="bg.subtle"
				onKeyDown={handleKeyDown}
			>
				<Box h="full" overflow="auto">
					<LayoutGroup id="app-sidebar">
						<Flex direction="column" h="full" minW="max-content" pb="3">
							<Flex
								data-tauri-drag-region
								h="80px"
								flexShrink={0}
								align="center"
								justify="start"
								paddingInline="4"
								pt="8"
							>
								<Text
									fontFamily="'Bricolage Grotesque Variable', sans-serif"
									fontWeight="700"
									color="fg.muted"
									letterSpacing="tight"
									userSelect="none"
									pointerEvents="none"
									whiteSpace="nowrap"
								>
									2Code
								</Text>
							</Flex>
							{projects.length === 0 && (
								<SidebarLink
									to="/"
									icon={<FiHome />}
									style={{ marginBottom: 20 }}
								>
									{m.home()}
								</SidebarLink>
							)}

							<HStack px="4" pt="2" pb="2" justify="space-between">
								<Text
									fontSize="xs"
									fontWeight="semibold"
									color="fg.muted"
									textTransform="uppercase"
									letterSpacing="wider"
									whiteSpace="nowrap"
								>
									{m.projects()}
								</Text>
								<IconButton
									id="add-project-button"
									aria-label={m.newProject()}
									variant="ghost"
									size="2xs"
									onClick={createDialog.onOpen}
								>
									<FiPlus />
								</IconButton>
							</HStack>

							{projects.map((project) => (
								<ProjectMenuItem key={project.id} project={project} />
							))}

							<Box flex="1" />

							<SidebarLink to="/settings" icon={<FiSettings />}>
								{m.settings()}
							</SidebarLink>
						</Flex>
					</LayoutGroup>
				</Box>
				<Box
					role="separator"
					aria-label="Resize sidebar"
					aria-orientation="vertical"
					aria-valuemin={APP_SIDEBAR_MIN_WIDTH}
					aria-valuemax={APP_SIDEBAR_MAX_WIDTH}
					aria-valuenow={sidebarWidth}
					tabIndex={0}
					position="absolute"
					top="0"
					right="-4px"
					bottom="0"
					w="8px"
					cursor="col-resize"
					zIndex={1}
					onPointerDown={resize.handlePointerDown}
					onKeyDown={resize.handleKeyDown}
					_before={{
						content: "\"\"",
						position: "absolute",
						top: 0,
						bottom: 0,
						left: "50%",
						transform: "translateX(-50%)",
						width: "1px",
						bg: resize.isDragging
							? "border.emphasized"
							: "transparent",
						transition: "background-color 0.16s ease",
					}}
					_hover={{
						_before: {
							bg: "border.subtle",
						},
					}}
					_focusVisible={{
						outline: "none",
						_before: {
							bg: "border.emphasized",
						},
					}}
				/>
			</Box>
			<CreateProjectDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
			/>
		</>
	);
}
