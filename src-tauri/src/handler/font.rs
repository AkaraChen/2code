use core_text::font::*;
use core_text::font_collection::create_for_all_families;
use core_text::font_descriptor::kCTFontMonoSpaceTrait;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Clone)]
pub struct SystemFont {
	pub family: String,
	pub is_mono: bool,
}

fn load_system_fonts() -> Vec<SystemFont> {
	let collection = create_for_all_families();
	let descriptors = collection.get_descriptors();

	let mut families: BTreeMap<String, bool> = BTreeMap::new();

	if let Some(descs) = descriptors {
		for i in 0..descs.len() {
			let desc = descs.get(i).unwrap();
			let family = desc.family_name();
			if family.is_empty() {
				continue;
			}
			// Create a minimal CTFont from the descriptor to read symbolic traits
			let ct_font = new_from_descriptor(&desc, 12.0);
			let traits = ct_font.symbolic_traits();
			let is_mono =
				(traits & kCTFontMonoSpaceTrait) == kCTFontMonoSpaceTrait;
			families
				.entry(family)
				.and_modify(|mono| *mono = *mono || is_mono)
				.or_insert(is_mono);
		}
	}

	families
		.into_iter()
		.map(|(family, is_mono)| SystemFont { family, is_mono })
		.collect()
}

#[tauri::command]
pub async fn list_system_fonts() -> Vec<SystemFont> {
	let fonts = tauri::async_runtime::spawn_blocking(load_system_fonts).await;
	fonts.unwrap_or_default()
}
