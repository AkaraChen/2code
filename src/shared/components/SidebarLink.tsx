import { HStack, Icon } from "@chakra-ui/react";
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
      gap="3"
      px="4"
      py="2"
      cursor="pointer"
      position="relative"
      bg={isActive ? "bg.subtle" : "transparent"}
      _hover={{ bg: "bg.subtle" }}
      style={style}
    >
      <NavLink to={to}>
        {isActive && <SidebarActiveIndicator insetInlineStart="1" />}
        <Icon fontSize="md">{icon}</Icon>
        {children}
      </NavLink>
    </HStack>
  );
}
