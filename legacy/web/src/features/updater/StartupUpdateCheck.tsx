import { useEffect } from "react";
import { toast } from "sonner";
import { openUpdatePage } from "@/generated";
import * as m from "@/paraglide/messages.js";

import { checkForUpdate } from "./store";

let updateToastShown = false;

export default function StartupUpdateCheck() {
	useEffect(() => {
		let cancelled = false;

		void checkForUpdate({ silent: true }).then((update) => {
			if (!update || cancelled || updateToastShown) {
				return;
			}

			updateToastShown = true;
			toast.info(m.updateAvailableTitle({ version: update.version }), {
				id: "update-available",
				description: m.updateAvailableDescription({
					currentVersion: update.currentVersion,
					version: update.version,
				}),
				duration: 12000,
				action: {
					label: m.openUpdatePage(),
					onClick: () => void openUpdatePage(),
				},
			});
		});

		return () => {
			cancelled = true;
		};
	}, []);

	return null;
}
