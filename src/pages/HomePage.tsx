import { Box, Heading } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

export default function HomePage() {
	return (
		<Box p="8" pt="16">
			<Heading size="2xl" fontWeight="bold">
				{m.home()}
			</Heading>
		</Box>
	);
}
