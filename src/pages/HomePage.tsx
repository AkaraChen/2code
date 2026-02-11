import { Heading } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

export default function HomePage() {
	return (
		<div className="page-padding">
			<Heading size="2xl" fontWeight="bold">
				{m.home()}
			</Heading>
		</div>
	);
}
