import { Box, Heading, Skeleton, Stack, Tabs } from "@chakra-ui/react";
import { Suspense } from "react";
import { TopBarSettings } from "@/features/topbar/TopBarSettings";
import * as m from "@/paraglide/messages.js";
import { AgentSettings } from "./AgentSettings";
import { NotificationSettings } from "./NotificationSettings";
import { GeneralSettings } from "./tabs/GeneralSettings";
import { TerminalSettings } from "./tabs/TerminalSettings";

/**
 * 设置页面主容器
 * 提供标签页导航,组合各个设置选项卡
 */
export default function SettingsPage() {
	return (
		<Box p="8" pt="16">
			<Stack gap="6">
				<Heading size="2xl" fontWeight="bold">
					{m.settings()}
				</Heading>
				<Tabs.Root defaultValue="general" variant="plain">
					<Tabs.List bg="bg.muted" rounded="l3" p="1">
						<Tabs.Trigger value="general">
							{m.general()}
						</Tabs.Trigger>
						<Tabs.Trigger value="terminal">
							{m.terminal()}
						</Tabs.Trigger>
						<Tabs.Trigger value="notification">
							{m.notification()}
						</Tabs.Trigger>
						<Tabs.Trigger value="topbar">{m.topbar()}</Tabs.Trigger>
						<Tabs.Trigger value="agents">{m.agents()}</Tabs.Trigger>
						<Tabs.Indicator rounded="l2" />
					</Tabs.List>
					<Tabs.Content value="general">
						<GeneralSettings />
					</Tabs.Content>
					<Tabs.Content value="terminal">
						<TerminalSettings />
					</Tabs.Content>
					<Tabs.Content value="notification">
						<NotificationSettings />
					</Tabs.Content>
					<Tabs.Content value="topbar">
						<TopBarSettings />
					</Tabs.Content>
					<Tabs.Content value="agents">
						<Suspense fallback={<Skeleton height="200px" />}>
							<AgentSettings />
						</Suspense>
					</Tabs.Content>
				</Tabs.Root>
			</Stack>
		</Box>
	);
}
