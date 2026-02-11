import { HStack, Icon } from "@chakra-ui/react";
import { NavLink, useMatch } from "react-router";

export function SidebarLink({
	to,
	icon,
	children,
}: {
	to: string;
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	const isActive = useMatch(to) !== null;
	return (
		<HStack
			asChild
			gap="3"
			px="4"
			py="2"
			cursor="pointer"
			borderLeft="3px solid"
			borderColor={isActive ? "colorPalette.solid" : "transparent"}
			bg={isActive ? "bg.subtle" : "transparent"}
			_hover={{ bg: "bg.subtle" }}
		>
			<NavLink to={to}>
				<Icon fontSize="md">{icon}</Icon>
				{children}
			</NavLink>
		</HStack>
	);
}
