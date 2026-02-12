import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	reset = () => {
		this.setState({ error: null });
	};

	render() {
		if (this.state.error) {
			if (this.props.fallback) {
				return this.props.fallback(this.state.error, this.reset);
			}
			return null;
		}
		return this.props.children;
	}
}
