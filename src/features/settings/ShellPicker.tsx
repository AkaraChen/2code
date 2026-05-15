import {
	Field,
	Input,
	Portal,
	Select,
	Stack,
	Text,
} from "@chakra-ui/react";
import { use, useMemo } from "react";
import type { AvailableShell } from "@/generated";
import { listAvailableShells } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { createCachedPromise } from "@/shared/lib/cachedPromise";
import { useLocale } from "@/shared/lib/locale";
import { createShellCollection, CUSTOM_SHELL_VALUE } from "./shellCollection";
import { useTerminalSettingsStore } from "./stores/terminalSettingsStore";

const getShellsPromise = createCachedPromise<AvailableShell[]>(() =>
	listAvailableShells(),
);

export function ShellPicker() {
	const shells = use(getShellsPromise());
	const { defaultShell, setDefaultShell } = useTerminalSettingsStore();
	const locale = useLocale();

	const shellCollection = useMemo(
		() => {
			void locale;
			return createShellCollection(
				shells,
				m.defaultOption(),
				m.customShell(),
			);
		},
		[locale, shells],
	);

	const isKnownShell = shells.some((shell) => shell.command === defaultShell);
	const selectValue = isKnownShell ? defaultShell : CUSTOM_SHELL_VALUE;

	return (
		<Field.Root>
			<Field.Label>{m.defaultShell()}</Field.Label>
			<Stack gap="2">
				<Select.Root
					collection={shellCollection}
					value={[selectValue]}
					onValueChange={(event) => {
						const value = event.value[0];
						if (!value || value === CUSTOM_SHELL_VALUE) return;
						setDefaultShell(value);
					}}
					size="sm"
				>
					<Select.HiddenSelect />
					<Select.Control>
						<Select.Trigger>
							<Select.ValueText />
						</Select.Trigger>
						<Select.IndicatorGroup>
							<Select.Indicator />
						</Select.IndicatorGroup>
					</Select.Control>
					<Portal>
						<Select.Positioner>
							<Select.Content>
								{shellCollection.items.map((item) => (
									<Select.Item item={item} key={item.value}>
										{item.label}
										<Select.ItemIndicator />
									</Select.Item>
								))}
							</Select.Content>
						</Select.Positioner>
					</Portal>
				</Select.Root>

				{selectValue === CUSTOM_SHELL_VALUE ? (
					<Input
						value={defaultShell}
						onChange={(event) => setDefaultShell(event.target.value)}
						placeholder={m.customShellPlaceholder()}
						fontFamily="mono"
						fontSize="sm"
					/>
				) : null}

				<Text fontSize="xs" color="fg.muted">
					{m.defaultShellDescription()}
				</Text>
			</Stack>
		</Field.Root>
	);
}
