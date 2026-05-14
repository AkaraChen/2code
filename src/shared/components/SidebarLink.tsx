import { Box, HStack, Icon } from "@chakra-ui/react";
import { NavLink, useMatch } from "react-router";
import { SidebarActiveIndicator } from "./SidebarActiveIndicator";

export function SidebarLink({
	to,
	icon,
	children,
	pattern,
	style,
}: {
	to: string;
	icon: React.ReactNode;
	children: React.ReactNode;
	pattern?: string;
	style?: React.CSSProperties;
}) {
	const isActive = useMatch(pattern ?? to) !== null;

	return (
		<HStack
			asChild
			data-sidebar-item
			userSelect="none"
			gap="3"
			w="full"
			minW="max-content"
			px="4"
			py="2"
			cursor="pointer"
			position="relative"
			bg={isActive ? "bg.subtle" : "transparent"}
			_hover={{ bg: "bg.subtle" }}
			style={style}
		>
			<NavLink to={to}>
				{isActive && <SidebarActiveIndicator insetInlineStart="0" />}
				<Icon fontSize="md" flexShrink={0}>
					{icon}
				</Icon>
				<Box as="span" whiteSpace="nowrap" flexShrink={0}>
					{children}
				</Box>
			</NavLink>
		</HStack>
	);
}
