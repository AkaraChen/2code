import { SideNav, SideNavItems, SideNavLink } from "@carbon/react";
import { Home, FolderOpen, Settings } from "@carbon/react/icons";
import { NavLink, useLocation } from "react-router";
import * as m from "@/paraglide/messages.js";

const Link = SideNavLink as React.ComponentType<
  React.ComponentProps<typeof SideNavLink> & { element: typeof NavLink; to: string }
>;

export default function AppSidebar() {
  const location = useLocation();

  return (
    <SideNav isFixedNav expanded isChildOfHeader={false} aria-label={m.sideNavLabel()}>
      <SideNavItems>
        <Link
          element={NavLink}
          to="/"
          renderIcon={Home}
          isActive={location.pathname === "/"}
        >
          {m.home()}
        </Link>
        <Link
          element={NavLink}
          to="/projects"
          renderIcon={FolderOpen}
          isActive={location.pathname === "/projects"}
        >
          {m.projects()}
        </Link>
        <div className="grow" />
        <Link
          element={NavLink}
          to="/settings"
          renderIcon={Settings}
          isActive={location.pathname === "/settings"}
        >
          {m.settings()}
        </Link>
      </SideNavItems>
    </SideNav>
  );
}
