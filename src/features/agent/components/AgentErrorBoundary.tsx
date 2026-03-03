import { Box, Text } from "@chakra-ui/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	/** Compact inline fallback for small units (e.g. a single message). */
	compact?: boolean;
	label?: string;
}

interface State {
	error: Error | null;
}

/**
 * Reusable error boundary for agent UI components.
 *
 * - compact=false (default): renders a visible but contained error card
 * - compact=true: renders a minimal one-liner so surrounding UI is undisturbed
 */
export class AgentErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[AgentErrorBoundary]", this.props.label ?? "", error, info);
	}

	render() {
		if (!this.state.error) return this.props.children;

		const msg = this.state.error.message;

		if (this.props.compact) {
			return (
				<Text fontSize="xs" color="red.fg" px="1">
					⚠ {msg}
				</Text>
			);
		}

		return (
			<Box
				px="3"
				py="2"
				mx="4"
				my="2"
				borderRadius="lg"
				bg="red.subtle"
				fontSize="sm"
			>
				<Text fontWeight="semibold" color="red.fg" mb="1">
					{this.props.label ?? "Something went wrong"}
				</Text>
				<Text color="red.fg" fontFamily="mono" fontSize="xs" wordBreak="break-all">
					{msg}
				</Text>
			</Box>
		);
	}
}
