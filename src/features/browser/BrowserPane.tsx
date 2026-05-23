import { Box, Flex, IconButton, Text } from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-shell";
import { useCallback } from "react";
import { FiExternalLink } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";

interface BrowserPaneProps {
	url: string;
	tabId: string;
}

export function BrowserPane({ url, tabId }: BrowserPaneProps) {
	const handleOpenExternal = useCallback(() => {
		void open(url);
	}, [url]);

	return (
		<Flex direction="column" h="full" w="full">
			<Flex
				align="center"
				gap="2"
				px="3"
				py="1"
				borderBottomWidth="1px"
				borderColor="border"
				bg="bg.subtle"
				minH="8"
			>
				<Text
					fontSize="xs"
					color="fg.muted"
					fontFamily="mono"
					flex="1"
					truncate
					title={url}
				>
					{url}
				</Text>
				<IconButton
					aria-label={m.browserOpenExternal()}
					size="xs"
					variant="ghost"
					onClick={handleOpenExternal}
					title={m.browserOpenExternal()}
				>
					<FiExternalLink />
				</IconButton>
			</Flex>
			<Box flex="1" minH="0">
				<iframe
					key={tabId}
					src={url}
					title={url}
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
					style={{
						width: "100%",
						height: "100%",
						border: "none",
					}}
				/>
			</Box>
		</Flex>
	);
}
