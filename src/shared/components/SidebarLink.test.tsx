import { ChakraProvider } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { appSystem } from "@/theme/system";
import { SidebarLink } from "./SidebarLink";

function renderLink(
	pathname: string,
	props?: Partial<React.ComponentProps<typeof SidebarLink>>,
) {
	return render(
		<ChakraProvider value={appSystem}>
			<MemoryRouter initialEntries={[pathname]}>
				<SidebarLink
					to="/settings"
					icon={<span data-testid="sidebar-icon">I</span>}
					{...props}
				>
					Settings
				</SidebarLink>
			</MemoryRouter>
		</ChakraProvider>,
	);
}

describe("sidebarLink", () => {
	it("renders the active indicator when the current route matches the link", () => {
		const { container } = renderLink("/settings");

		expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
			"href",
			"/settings",
		);
		expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(
			2,
		);
	});

	it("omits the active indicator when the route does not match", () => {
		const { container } = renderLink("/projects");

		expect(
			screen.getByRole("link", { name: /settings/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /settings/i }),
		).not.toHaveAttribute("aria-current");
		expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(
			1,
		);
	});

	it("supports custom route patterns for nested sections", () => {
		const { container } = renderLink("/projects/p1/settings", {
			to: "/projects/p1",
			pattern: "/projects/:projectId/*",
		});

		expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
			"href",
			"/projects/p1",
		);
		expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(
			2,
		);
	});
});
