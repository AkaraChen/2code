import { useEffect } from "react";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";import { toast } from "sonner";

import { checkForUpdate } from "./store";

let updateToastShown = false;

export default function StartupUpdateCheck() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    void checkForUpdate({ silent: true }).then((update) => {
      if (!update || cancelled || updateToastShown) {
        return;
      }

      updateToastShown = true;
      toast.info(


        m.updateAvailableTitle({ version: update.version }), { id: "update-available",
          description: m.updateAvailableDescription({
            currentVersion: update.currentVersion,
            version: update.version
          }),
          duration: 12000,

          action: {
            label: m.openUpdatePage(),
            onClick: () => navigate("/settings?tab=about")
          } });

    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
