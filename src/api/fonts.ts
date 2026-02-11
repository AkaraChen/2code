import { invoke } from "@tauri-apps/api/core";

export interface SystemFont {
	family: string;
	is_mono: boolean;
}

export const fontsApi = {
	listSystemFonts: () => invoke<SystemFont[]>("list_system_fonts"),
};
