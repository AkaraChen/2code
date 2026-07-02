import {
	isPermissionGranted,
	sendNotification,
} from "@tauri-apps/plugin-notification";
import consola from "consola";
import * as m from "@/paraglide/messages.js";
import type { AgentStatus } from "../store";

export interface NotifyDecisionInput {
	status: AgentStatus | null;
	previousStatus: AgentStatus | null;
	notificationsEnabled: boolean;
	windowFocused: boolean;
}

export function shouldNotifyAgentWaiting({
	status,
	previousStatus,
	notificationsEnabled,
	windowFocused,
}: NotifyDecisionInput): boolean {
	return (
		status === "waiting" &&
		previousStatus !== "waiting" &&
		notificationsEnabled &&
		!windowFocused
	);
}

export async function sendAgentWaitingNotification({
	agentId,
	tabTitle,
}: {
	agentId: string | null;
	tabTitle: string;
}): Promise<void> {
	try {
		const granted = await isPermissionGranted();
		if (!granted) return;

		const agent = agentId?.trim();
		sendNotification({
			title: agent
				? m.agentWaitingNotificationTitle({ agent })
				: m.agentWaitingNotificationTitleGeneric(),
			body: m.agentWaitingNotificationBody({ tab: tabTitle }),
		});
	} catch (error) {
		consola.warn("[pty-terminal] failed to send agent notification", error);
	}
}
