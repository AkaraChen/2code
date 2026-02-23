//! ACP agent distribution types.
//! Based on `schemas/acp-distribution.json` (from agentclientprotocol/registry agent.schema.json).

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Top-level distribution spec stored as `distribution_json` in `marketplace_agents`.
/// At most one of `npx`, `uvx`, or `binary` will be present.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Distribution {
	pub npx: Option<PackageDistribution>,
	pub uvx: Option<PackageDistribution>,
	pub binary: Option<BinaryDistribution>,
}

/// Package-manager based distribution (npm / uv).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PackageDistribution {
	pub package: String,
	pub args: Option<Vec<String>>,
	pub env: Option<HashMap<String, String>>,
}

/// Platform-keyed binary distribution.
/// Keys: `darwin-aarch64`, `darwin-x86_64`, `linux-aarch64`, `linux-x86_64`,
/// `windows-aarch64`, `windows-x86_64`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BinaryDistribution(pub HashMap<String, BinaryTarget>);

/// A single platform's binary target.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BinaryTarget {
	pub archive: String,
	pub cmd: String,
	pub args: Option<Vec<String>>,
	pub env: Option<HashMap<String, String>>,
}

impl Distribution {
	/// Parse from the `distribution_json` column of `marketplace_agents`.
	pub fn from_json(s: &str) -> Result<Self, AppError> {
		serde_json::from_str(s)
			.map_err(|e| AppError::DbError(format!("invalid distribution JSON: {e}")))
	}

	/// Resolve to `(program, args, env)` for process spawning.
	///
	/// Priority: `npx` → `uvx` → `binary` (current platform).
	pub fn resolve_launch(
		&self,
	) -> Result<(PathBuf, Vec<String>, HashMap<String, String>), AppError> {
		if let Some(pkg) = &self.npx {
			let mut args = vec![pkg.package.clone()];
			args.extend(pkg.args.clone().unwrap_or_default());
			return Ok((
				PathBuf::from("npx"),
				args,
				pkg.env.clone().unwrap_or_default(),
			));
		}

		if let Some(pkg) = &self.uvx {
			let mut args = vec![pkg.package.clone()];
			args.extend(pkg.args.clone().unwrap_or_default());
			return Ok((
				PathBuf::from("uvx"),
				args,
				pkg.env.clone().unwrap_or_default(),
			));
		}

		if let Some(binary) = &self.binary {
			let key = current_platform_key();
			if let Some(target) = binary.0.get(key) {
				return Ok((
					PathBuf::from(&target.cmd),
					target.args.clone().unwrap_or_default(),
					target.env.clone().unwrap_or_default(),
				));
			}
		}

		Err(AppError::NotFound(
			"no supported distribution for current platform".into(),
		))
	}
}

fn current_platform_key() -> &'static str {
	if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
		"darwin-aarch64"
	} else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
		"darwin-x86_64"
	} else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
		"linux-aarch64"
	} else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
		"linux-x86_64"
	} else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
		"windows-aarch64"
	} else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
		"windows-x86_64"
	} else {
		""
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_parse_npx_distribution() {
		let json = r#"{"npx":{"package":"@scope/agent","args":["--flag"],"env":{"KEY":"val"}}}"#;
		let dist = Distribution::from_json(json).unwrap();
		assert!(dist.npx.is_some());
		let (prog, args, env) = dist.resolve_launch().unwrap();
		assert_eq!(prog, PathBuf::from("npx"));
		assert_eq!(args, vec!["@scope/agent", "--flag"]);
		assert_eq!(env.get("KEY").map(String::as_str), Some("val"));
	}

	#[test]
	fn test_parse_uvx_distribution() {
		let json = r#"{"uvx":{"package":"my-agent"}}"#;
		let dist = Distribution::from_json(json).unwrap();
		let (prog, args, env) = dist.resolve_launch().unwrap();
		assert_eq!(prog, PathBuf::from("uvx"));
		assert_eq!(args, vec!["my-agent"]);
		assert!(env.is_empty());
	}

	#[test]
	fn test_empty_distribution_errors() {
		let json = r#"{}"#;
		let dist = Distribution::from_json(json).unwrap();
		assert!(dist.resolve_launch().is_err());
	}
}
