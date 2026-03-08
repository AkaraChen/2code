import {
	Box,
	Heading,
	HStack,
	SegmentGroup,
	Stack,
	Tooltip,
} from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { Outlet, useLocation, useNavigate } from "react-router";

type Mode = "manage" | "store";
type Filter = "skills" | "snippets" | "agents";

export default function AssetsLayout() {
	const location = useLocation();
	const navigate = useNavigate();

	const pathSegments = location.pathname.split("/").filter(Boolean);
	const modeSegment = pathSegments[1] as Mode | undefined;
	const filterSegment = pathSegments[2] as Filter | undefined;

	const mode: Mode = modeSegment === "store" ? "store" : "manage";
	const filter: Filter = ["skills", "snippets", "agents"].includes(
		filterSegment as any,
	)
		? (filterSegment as Filter)
		: "skills";

	const handleModeChange = (newMode: Mode) => {
		if (newMode === "store" && filter === "snippets") {
			navigate(`/assets/store/agents`);
		} else {
			navigate(`/assets/${newMode}/${filter}`);
		}
	};

	const handleFilterChange = (newFilter: Filter) => {
		navigate(`/assets/${mode}/${newFilter}`);
	};

	return (
		<Box p="8" pt="16">
			<Stack gap="6">
				<Heading size="2xl" fontWeight="bold">
					{m.assets()}
				</Heading>

				<HStack justify="space-between" align="center">
					<SegmentGroup.Root
						size="sm"
						width="fit-content"
						value={filter}
						onValueChange={(e) =>
							e.value && handleFilterChange(e.value as Filter)
						}
					>
						<SegmentGroup.Indicator />
						{[
							{ value: "skills", label: m.skills() },
							{ value: "snippets", label: m.snippets() },
							{ value: "agents", label: m.agents() },
						].map((item) => {
							const isDisabled =
								mode === "store" && item.value === "snippets";
							const segmentItem = (
								<SegmentGroup.Item
									key={item.value}
									value={item.value}
									disabled={isDisabled}
								>
									<SegmentGroup.ItemText>
										{item.label}
									</SegmentGroup.ItemText>
									<SegmentGroup.ItemHiddenInput />
								</SegmentGroup.Item>
							);

							if (isDisabled) {
								return (
									<Tooltip.Root key={item.value}>
										<Tooltip.Trigger asChild>
											{segmentItem}
										</Tooltip.Trigger>
										<Tooltip.Positioner>
											<Tooltip.Content>
												{m.wip()}
											</Tooltip.Content>
										</Tooltip.Positioner>
									</Tooltip.Root>
								);
							}

							return segmentItem;
						})}
					</SegmentGroup.Root>

					<SegmentGroup.Root
						size="sm"
						width="fit-content"
						value={mode}
						onValueChange={(e) =>
							e.value && handleModeChange(e.value as Mode)
						}
					>
						<SegmentGroup.Indicator />
						{[
							{ value: "manage", label: m.management() },
							{ value: "store", label: m.store() },
						].map((item) => (
							<SegmentGroup.Item
								key={item.value}
								value={item.value}
							>
								<SegmentGroup.ItemText>
									{item.label}
								</SegmentGroup.ItemText>
								<SegmentGroup.ItemHiddenInput />
							</SegmentGroup.Item>
						))}
					</SegmentGroup.Root>
				</HStack>

				<Box>
					<Outlet />
				</Box>
			</Stack>
		</Box>
	);
}
