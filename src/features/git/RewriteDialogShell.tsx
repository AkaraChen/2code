// Shared chrome for the Phase 2.5 rewrite dialogs (edit message, squash,
// edit author/committer). Modal-over-portal with header / content / footer
// rows + an inline error banner.

import { Button, HStack, Portal, Stack, Text } from "@chakra-ui/react";

interface RewriteDialogShellProps {
	title: string;
	children: React.ReactNode;
	onClose: () => void;
	onSubmit: () => void;
	submitting: boolean;
	submitDisabled: boolean;
	submitLabel: string;
	error?: string | null;
	maxWidth?: string;
}

export default function RewriteDialogShell({
	title,
	children,
	onClose,
	onSubmit,
	submitting,
	submitDisabled,
	submitLabel,
	error,
	maxWidth = "560px",
}: RewriteDialogShellProps) {
	return (
		<Portal>
			<div
				style={{
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,0.5)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 1100,
				}}
				onClick={onClose}
			>
				<div
					onClick={(e) => e.stopPropagation()}
					style={{
						background: "var(--chakra-colors-bg)",
						borderRadius: "8px",
						padding: "16px",
						width: "90%",
						maxWidth,
						maxHeight: "80vh",
						overflow: "auto",
						boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
					}}
				>
					<Stack gap="3">
						<Text fontWeight="semibold" fontSize="md">
							{title}
						</Text>

						{children}

						{error && (
							<Text
								fontSize="xs"
								color="red.fg"
								bg="red.subtle"
								p="2"
								borderRadius="md"
								whiteSpace="pre-wrap"
							>
								{error}
							</Text>
						)}

						<HStack gap="2" justify="flex-end" pt="2">
							<Button
								size="sm"
								variant="ghost"
								onClick={onClose}
								disabled={submitting}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								disabled={submitDisabled}
								loading={submitting}
								onClick={onSubmit}
							>
								{submitLabel}
							</Button>
						</HStack>
					</Stack>
				</div>
			</div>
		</Portal>
	);
}
