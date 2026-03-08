import {
	Alert,
	Button,
	Code,
	EmptyState,
	Flex,
	HStack,
	IconButton,
	Stack,
	Table,
	Text,
	Skeleton,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import { useSnippets } from "@/features/assets/hooks/useSnippets";
import { SnippetFormDialog } from "../components/SnippetFormDialog";
import { SnippetDeleteDialog } from "../components/SnippetDeleteDialog";

function SnippetsListContent() {
	const { data: snippets } = useSnippets();
	const [editingSnippet, setEditingSnippet] = useState<{
		id: string;
		name: string;
		trigger: string;
		content: string;
	} | null>(null);
	const [formOpen, setFormOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

	const openCreate = () => {
		setEditingSnippet(null);
		setFormOpen(true);
	};

	const openEdit = (snippet: {
		id: string;
		name: string;
		trigger: string;
		content: string;
	}) => {
		setEditingSnippet(snippet);
		setFormOpen(true);
	};

	return (
		<Stack gap="4">
			<Alert.Root status="info" size="sm">
				<Alert.Indicator />
				<Alert.Content>
					<Alert.Description>
						{m.snippetsDescription()}
					</Alert.Description>
				</Alert.Content>
			</Alert.Root>

			<Flex>
				<Button size="sm" onClick={openCreate}>
					<LuPlus /> {m.create()}
				</Button>
			</Flex>

			{snippets.length === 0 ? (
				<EmptyState.Root>
					<EmptyState.Content>
						<EmptyState.Description>
							{m.noSnippetsYet()}
						</EmptyState.Description>
					</EmptyState.Content>
				</EmptyState.Root>
			) : (
				<Table.Root size="sm" variant="outline">
					<Table.Header>
						<Table.Row>
							<Table.ColumnHeader>
								{m.snippetName()}
							</Table.ColumnHeader>
							<Table.ColumnHeader>
								{m.snippetTrigger()}
							</Table.ColumnHeader>
							<Table.ColumnHeader>
								{m.snippetContent()}
							</Table.ColumnHeader>
							<Table.ColumnHeader w="100px" />
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{snippets.map((snippet) => (
							<Table.Row key={snippet.id}>
								<Table.Cell>{snippet.name}</Table.Cell>
								<Table.Cell>
									<Code size="sm">{snippet.trigger}</Code>
								</Table.Cell>
								<Table.Cell>
									<Text truncate maxW="200px">
										{snippet.content}
									</Text>
								</Table.Cell>
								<Table.Cell>
									<HStack>
										<IconButton
											size="xs"
											variant="ghost"
											onClick={() => openEdit(snippet)}
											aria-label={m.snippetEdit()}
										>
											<LuPencil />
										</IconButton>
										<IconButton
											size="xs"
											variant="ghost"
											colorPalette="red"
											onClick={() =>
												setDeleteTarget(snippet.id)
											}
											aria-label={m.snippetDelete()}
										>
											<LuTrash2 />
										</IconButton>
									</HStack>
								</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table.Root>
			)}

			<SnippetFormDialog
				open={formOpen}
				onOpenChange={setFormOpen}
				editingSnippet={editingSnippet}
			/>

			<SnippetDeleteDialog
				deleteTarget={deleteTarget}
				onClose={() => setDeleteTarget(null)}
			/>
		</Stack>
	);
}

export default function ListSnippetsPage() {
	return (
		<Suspense fallback={<Skeleton height="200px" />}>
			<SnippetsListContent />
		</Suspense>
	);
}
