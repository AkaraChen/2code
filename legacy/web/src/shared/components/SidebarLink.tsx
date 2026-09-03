import { NavLink, useMatch } from "react-router";
import {
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

export function SidebarLink({
	to,
	icon,
	children,
	pattern,
}: {
	to: string;
	icon: React.ReactNode;
	children: React.ReactNode;
	pattern?: string;
}) {
	const isActive = useMatch(pattern ?? to) !== null;

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				render={<NavLink to={to} />}
				isActive={isActive}
				data-sidebar-item
			>
				{icon}
				<span>{children}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
