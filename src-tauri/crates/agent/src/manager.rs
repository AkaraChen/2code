use std::path::PathBuf;

use sandbox_agent_agent_credentials::{
	extract_all_credentials, CredentialExtractionOptions, ProviderCredentials,
};
use sandbox_agent_agent_management::agents::{
	AgentError, AgentId, AgentInstallStatus, AgentManager,
	AgentProcessLaunchSpec, InstallOptions, InstallResult,
};
use serde::Serialize;

#[derive(Clone)]
pub struct AgentManagerWrapper {
	inner: AgentManager,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStatusInfo {
	pub id: String,
	pub display_name: String,
	pub native_required: bool,
	pub native_installed: bool,
	pub native_version: Option<String>,
	pub acp_installed: bool,
	pub acp_version: Option<String>,
	pub ready: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CredentialInfo {
	pub anthropic: Option<CredentialEntry>,
	pub openai: Option<CredentialEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CredentialEntry {
	pub source: String,
	pub provider: String,
	pub auth_type: String,
	pub key_preview: String,
}

fn display_name(agent: AgentId) -> &'static str {
	match agent {
		AgentId::Claude => "Claude Code",
		AgentId::Codex => "Codex",
		AgentId::Opencode => "OpenCode",
		AgentId::Amp => "Amp",
		AgentId::Pi => "Pi",
		AgentId::Cursor => "Cursor",
		AgentId::Mock => "Mock",
	}
}

fn mask_key(key: &str) -> String {
	if key.len() <= 8 {
		return "*".repeat(key.len());
	}
	let prefix = &key[..4];
	let suffix = &key[key.len() - 4..];
	format!("{prefix}...{suffix}")
}

fn to_credential_entry(cred: &ProviderCredentials) -> CredentialEntry {
	CredentialEntry {
		source: cred.source.clone(),
		provider: cred.provider.clone(),
		auth_type: format!("{:?}", cred.auth_type).to_lowercase(),
		key_preview: mask_key(&cred.api_key),
	}
}

impl AgentManagerWrapper {
	pub fn new(install_dir: PathBuf) -> Result<Self, AgentError> {
		let inner = AgentManager::new(install_dir)?;
		Ok(Self { inner })
	}

	pub fn list_status(&self) -> Vec<AgentStatusInfo> {
		self.inner
			.list_status()
			.into_iter()
			.filter(|s| s.agent != AgentId::Mock)
			.map(|s| to_status_info(s))
			.collect()
	}

	pub fn install(
		&self,
		agent_str: &str,
	) -> Result<InstallResult, AgentError> {
		let agent = parse_agent_id(agent_str)?;
		self.inner.install(agent, InstallOptions::default())
	}

	pub fn detect_credentials(&self) -> CredentialInfo {
		let options = CredentialExtractionOptions::new();
		let creds = extract_all_credentials(&options);
		CredentialInfo {
			anthropic: creds.anthropic.as_ref().map(to_credential_entry),
			openai: creds.openai.as_ref().map(to_credential_entry),
		}
	}

	pub fn resolve_launch(
		&self,
		agent_str: &str,
	) -> Result<AgentProcessLaunchSpec, AgentError> {
		let agent = parse_agent_id(agent_str)?;
		self.inner.resolve_agent_process(agent)
	}
}

fn parse_agent_id(agent_str: &str) -> Result<AgentId, AgentError> {
	AgentId::parse(agent_str).ok_or_else(|| AgentError::UnsupportedAgent {
		agent: agent_str.to_string(),
	})
}

fn to_status_info(s: AgentInstallStatus) -> AgentStatusInfo {
	let ready = if s.native_required {
		s.native_installed && s.agent_process_installed
	} else {
		s.agent_process_installed
	};
	AgentStatusInfo {
		id: s.agent.as_str().to_string(),
		display_name: display_name(s.agent).to_string(),
		native_required: s.native_required,
		native_installed: s.native_installed,
		native_version: s.native_version,
		acp_installed: s.agent_process_installed,
		acp_version: s.agent_process_version,
		ready,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_mask_key() {
		assert_eq!(mask_key("sk-ant-abcdef1234567890"), "sk-a...7890");
		assert_eq!(mask_key("short"), "*****");
		assert_eq!(mask_key("12345678"), "********");
		assert_eq!(mask_key("123456789"), "1234...6789");
	}

	#[test]
	fn test_mask_key_edge_cases() {
		assert_eq!(mask_key(""), "");
		assert_eq!(mask_key("a"), "*");
		assert_eq!(mask_key("ab"), "**");
		assert_eq!(mask_key("abcd"), "****");
		assert_eq!(mask_key("abcdefghi"), "abcd...fghi");
	}

	#[test]
	fn test_display_name() {
		assert_eq!(display_name(AgentId::Claude), "Claude Code");
		assert_eq!(display_name(AgentId::Codex), "Codex");
	}

	#[test]
	fn test_display_name_all_agents() {
		assert_eq!(display_name(AgentId::Opencode), "OpenCode");
		assert_eq!(display_name(AgentId::Amp), "Amp");
		assert_eq!(display_name(AgentId::Pi), "Pi");
		assert_eq!(display_name(AgentId::Cursor), "Cursor");
		assert_eq!(display_name(AgentId::Mock), "Mock");
	}

	#[test]
	fn test_parse_agent_id_valid() {
		assert!(parse_agent_id("claude").is_ok());
		assert!(parse_agent_id("codex").is_ok());
		assert!(parse_agent_id("opencode").is_ok());
		assert!(parse_agent_id("amp").is_ok());
		assert!(parse_agent_id("pi").is_ok());
		assert!(parse_agent_id("cursor").is_ok());
	}

	#[test]
	fn test_parse_agent_id_invalid() {
		assert!(parse_agent_id("nonexistent").is_err());
		assert!(parse_agent_id("").is_err());
		assert!(parse_agent_id("Claude").is_err()); // case-sensitive
	}

	#[test]
	fn test_to_status_info_ready_when_acp_installed_no_native_required() {
		let status = AgentInstallStatus {
			agent: AgentId::Claude,
			native_required: false,
			native_installed: false,
			native_version: None,
			agent_process_installed: true,
			agent_process_source: None,
			agent_process_version: Some("1.0.0".to_string()),
			unstable_enabled: false,
		};
		let info = to_status_info(status);
		assert!(info.ready);
		assert_eq!(info.id, "claude");
		assert_eq!(info.display_name, "Claude Code");
		assert!(info.acp_installed);
		assert_eq!(info.acp_version, Some("1.0.0".to_string()));
	}

	#[test]
	fn test_to_status_info_not_ready_missing_acp() {
		let status = AgentInstallStatus {
			agent: AgentId::Codex,
			native_required: false,
			native_installed: false,
			native_version: None,
			agent_process_installed: false,
			agent_process_source: None,
			agent_process_version: None,
			unstable_enabled: false,
		};
		let info = to_status_info(status);
		assert!(!info.ready);
		assert!(!info.acp_installed);
	}

	#[test]
	fn test_to_status_info_not_ready_missing_native() {
		let status = AgentInstallStatus {
			agent: AgentId::Codex,
			native_required: true,
			native_installed: false,
			native_version: None,
			agent_process_installed: true,
			agent_process_source: None,
			agent_process_version: Some("1.0.0".to_string()),
			unstable_enabled: false,
		};
		let info = to_status_info(status);
		assert!(!info.ready);
		assert!(info.native_required);
		assert!(!info.native_installed);
	}

	#[test]
	fn test_to_status_info_ready_with_native() {
		let status = AgentInstallStatus {
			agent: AgentId::Codex,
			native_required: true,
			native_installed: true,
			native_version: Some("2.0.0".to_string()),
			agent_process_installed: true,
			agent_process_source: None,
			agent_process_version: Some("1.0.0".to_string()),
			unstable_enabled: false,
		};
		let info = to_status_info(status);
		assert!(info.ready);
		assert!(info.native_installed);
		assert_eq!(info.native_version, Some("2.0.0".to_string()));
	}
}
