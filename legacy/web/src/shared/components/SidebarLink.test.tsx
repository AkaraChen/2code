import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarLink } from "./SidebarLink";

function renderLink(
	pathname: string,
	props?: Partial<React.ComponentProps<typeof SidebarLink>>,
) {
	return render(
		<SidebarProvider>
			<MemoryRouter initialEntries={[pathname]}>
				<SidebarLink
					to="/settings"
					icon={<span data-testid="sidebar-icon">I</span>}
					{...props}
				>
					Settings
				</SidebarLink>
			</MemoryRouter>
		</SidebarProvider>,
	);
}

describe("sidebarLink", () => {
	it("marks the menu button active when the current route matches the link", () => {
		renderLink("/settings");

		const link = screen.getByRole("link", { name: /settings/i });

		expect(link).toHaveAttribute("href", "/settings");
		expect(link).toHaveAttribute("data-sidebar", "menu-button");
		expect(link).toHaveAttribute("data-active");
		expect(link).toHaveAttribute(
			"aria-current",
			"page",
		);
	});

	it("does not mark the menu button active when the route does not match", () => {
		renderLink("/projects");

		const link = screen.getByRole("link", { name: /settings/i });

		expect(link).toHaveAttribute("data-sidebar", "menu-button");
		expect(link).not.toHaveAttribute("data-active");
		expect(link).not.toHaveAttribute("aria-current");
	});

	it("supports custom route patterns for nested sections", () => {
		renderLink("/projects/p1/settings", {
			to: "/projects/p1",
			pattern: "/projects/:projectId/*",
		});

		const link = screen.getByRole("link", { name: /settings/i });

		expect(link).toHaveAttribute("href", "/projects/p1");
		expect(link).toHaveAttribute("data-sidebar", "menu-button");
		expect(link).toHaveAttribute("data-active");
		expect(link).toHaveAttribute(
			"aria-current",
			"page",
		);
	});
});
