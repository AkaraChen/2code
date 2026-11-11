// 2code for Herdr: one mod, many parts. Herdr won't let a mod import from
// another mod's folder, so everything that shares code (i18n, git, 2code.json)
// lives here and the layout picks a part with `props.part`.
import { View, div } from "gpui-kit";
import { props } from "herdr";
import { Sidebar, SidebarHeader } from "./parts/sidebar.js";
import { Topbar } from "./parts/topbar.js";
import { Tabs } from "./parts/tabs.js";
import { Templates } from "./parts/templates.js";
import { Teardown } from "./parts/teardown.js";
import { Files } from "./parts/files.js";
import { Changes } from "./parts/changes.js";

const PARTS = {
  header: SidebarHeader,
  sidebar: Sidebar,
  topbar: Topbar,
  tabs: Tabs,
  templates: Templates,
  teardown: Teardown,
  files: Files,
  changes: Changes,
};

class Missing {
  constructor(name) { this.name = name; }
  render() { return div().p(8).child(`2code: unknown part "${this.name}"`); }
}

export default class TwoCode extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const Part = PARTS[p.part];
    this.part = Part ? new Part() : new Missing(p.part);
    this.part.init?.(p, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }

  async close(cx) {
    await this.part.close?.(cx);
  }
}
