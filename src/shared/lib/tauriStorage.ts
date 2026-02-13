import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("settings.json", { autoSave: true });

export const tauriStorage = {
	getItem: async (name: string) => {
		const val = await store.get(name);
		return val != null ? JSON.stringify(val) : null;
	},
	setItem: async (name: string, value: string) => {
		await store.set(name, JSON.parse(value));
	},
	removeItem: async (name: string) => {
		await store.delete(name);
	},
};
