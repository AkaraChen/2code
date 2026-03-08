import { Badge, EmptyState } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

export default function InstallSnippetPage() {
	return (
		<EmptyState.Root>
			<EmptyState.Content>
				<EmptyState.Title>{m.snippets()}</EmptyState.Title>
				<EmptyState.Description>
					<Badge variant="outline">{m.wip()}</Badge>
				</EmptyState.Description>
			</EmptyState.Content>
		</EmptyState.Root>
	);
}
