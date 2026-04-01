import { useEffect, useMemo } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import * as m from "@/paraglide/messages.js";

interface TourOnboardingProps {
	isEnabled: boolean;
}

export function TourOnboarding({ isEnabled }: TourOnboardingProps) {
	const driverObj = useMemo<any>(() => {
		if (!isEnabled) return null;

		const d = driver({
			animate: true,
			showProgress: false,
			showButtons: ["close"],
			popoverClass: "driver-popover-theme",
			steps: [
					{
						element: "#add-project-button",
						popover: {
							title: m.onboardingTourTitle(),
							description: m.onboardingTourDesc(),
							side: "right",
							align: "start",
						},
						onHighlighted: () => {
							const target = document.querySelector("#add-project-button");
							if (target) {
								target.addEventListener(
									"click",
									() => {
										d.destroy();
									},
									{ once: true },
								);
							}
						}
					},

			],
		});
		return d;
	}, [isEnabled]);

	useEffect(() => {
		if (driverObj) {
			// Small delay to ensure DOM element is mounted
			const timer = setTimeout(() => {
				driverObj.drive();
			}, 300);
			return () => clearTimeout(timer);
		}

		return () => {
			if (driverObj) {
				driverObj.destroy();
			}
		};
	}, [driverObj]);

	return null;
}
