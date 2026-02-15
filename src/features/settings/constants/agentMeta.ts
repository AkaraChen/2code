import * as m from "@/paraglide/messages.js";

/**
 * Agent 元数据配置
 * 包含每个 Agent 的提供商和描述信息
 */
export const AGENT_META: Record<
	string,
	{ provider: () => string; description: () => string }
> = {
	claude: {
		provider: () => m.agentProviderAnthropic(),
		description: () => m.agentDescClaude(),
	},
	codex: {
		provider: () => m.agentProviderOpenAI(),
		description: () => m.agentDescCodex(),
	},
	opencode: {
		provider: () => m.agentProviderOpenSource(),
		description: () => m.agentDescOpencode(),
	},
	amp: {
		provider: () => m.agentProviderSourcegraph(),
		description: () => m.agentDescAmp(),
	},
	pi: {
		provider: () => m.agentProviderOpenSource(),
		description: () => m.agentDescPi(),
	},
	cursor: {
		provider: () => m.agentProviderAnysphere(),
		description: () => m.agentDescCursor(),
	},
};
