use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Debug, Serialize, Clone)]
pub struct SystemFont {
	pub family: String,
	pub is_mono: bool,
}

static SYSTEM_FONTS: OnceLock<Vec<SystemFont>> = OnceLock::new();

fn fonts_from_family_map(families: BTreeMap<String, bool>) -> Vec<SystemFont> {
	families
		.into_iter()
		.map(|(family, is_mono)| SystemFont { family, is_mono })
		.collect()
}

#[cfg(target_os = "macos")]
fn load_system_fonts() -> Vec<SystemFont> {
	use core_text::font::*;
	use core_text::font_collection::create_for_all_families;
	use core_text::font_descriptor::kCTFontMonoSpaceTrait;

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

	fonts_from_family_map(families)
}

#[cfg(target_os = "linux")]
fn load_system_fonts() -> Vec<SystemFont> {
	let mut db = fontdb::Database::new();
	db.load_system_fonts();

	let mut families = BTreeMap::new();
	for face in db.faces() {
		for (family, _) in &face.families {
			let family = family.trim();
			if family.is_empty() {
				continue;
			}

			families
				.entry(family.to_string())
				.and_modify(|mono| *mono = *mono || face.monospaced)
				.or_insert(face.monospaced);
		}
	}

	fonts_from_family_map(families)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn load_system_fonts() -> Vec<SystemFont> {
	Vec::new()
}

fn cached_system_fonts() -> Vec<SystemFont> {
	SYSTEM_FONTS.get_or_init(load_system_fonts).clone()
}

#[tauri::command]
pub async fn list_system_fonts() -> Vec<SystemFont> {
	let fonts = tauri::async_runtime::spawn_blocking(cached_system_fonts).await;
	fonts.unwrap_or_default()
}
