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
	const filter: Filter = ["skills", "snippets", "agents"].includes(filterSegment as any) ? filterSegment as Filter : "skills";

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
						{mode === "store" ? (
							<>
								<SegmentGroup.Item value="skills">
									<SegmentGroup.ItemText>{m.skills()}</SegmentGroup.ItemText>
									<SegmentGroup.ItemHiddenInput />
								</SegmentGroup.Item>
								<Tooltip.Root>
									<Tooltip.Trigger asChild>
										<SegmentGroup.Item
											value="snippets"
											disabled
										>
											<SegmentGroup.ItemText>{m.snippets()}</SegmentGroup.ItemText>
											<SegmentGroup.ItemHiddenInput />
										</SegmentGroup.Item>
									</Tooltip.Trigger>
									<Tooltip.Positioner>
										<Tooltip.Content>
											{m.wip()}
										</Tooltip.Content>
									</Tooltip.Positioner>
								</Tooltip.Root>
								<SegmentGroup.Item value="agents">
									<SegmentGroup.ItemText>{m.agents()}</SegmentGroup.ItemText>
									<SegmentGroup.ItemHiddenInput />
								</SegmentGroup.Item>
							</>
						) : (
							<SegmentGroup.Items
								items={[
									{ value: "skills", label: m.skills() },
									{ value: "snippets", label: m.snippets() },
									{ value: "agents", label: m.agents() },
								]}
							/>
						)}
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
						<SegmentGroup.Items
							items={[
								{ value: "manage", label: m.management() },
								{ value: "store", label: m.store() },
							]}
						/>
					</SegmentGroup.Root>
				</HStack>

				<Box>
					<Outlet />
				</Box>
			</Stack>
		</Box>
	);
}
