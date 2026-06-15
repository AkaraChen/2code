use clap::{Parser, Subcommand, ValueEnum};
use serde::Deserialize;

#[derive(Deserialize)]
struct NotifyResponse {
	played: bool,
}

#[derive(Parser)]
#[command(name = "2code-helper", about = "2code CLI helper")]
struct Cli {
	#[command(subcommand)]
	command: Commands,
}

#[derive(Clone, Copy, ValueEnum)]
enum AgentStatusArg {
	Running,
	Waiting,
	Idle,
}

impl AgentStatusArg {
	fn as_str(self) -> &'static str {
		match self {
			Self::Running => "running",
			Self::Waiting => "waiting",
			Self::Idle => "idle",
		}
	}
}

#[derive(Subcommand)]
enum Commands {
	/// Trigger a notification sound
	Notify,
	/// Update the agent status indicator for the current PTY session
	Status { status: AgentStatusArg },
}

fn main() {
	let cli = Cli::parse();
	match cli.command {
		Commands::Notify => {
			let url = helper_url();
			let notify_url = format!("{url}/notify");
			match ureq::get(&notify_url).call() {
				Ok(mut resp) => {
					let body: NotifyResponse = resp
						.body_mut()
						.read_json()
						.unwrap_or(NotifyResponse { played: false });
					if !body.played {
						std::process::exit(1);
					}
				}
				Err(e) => {
					eprintln!("notify failed: {e}");
					std::process::exit(1);
				}
			}
		}
		Commands::Status { status } => {
			let Some(session_id) = session_id() else {
				return;
			};
			let url = helper_url();
			let status_url = format!(
				"{url}/status?session_id={session_id}&status={}",
				status.as_str(),
			);
			if let Err(e) = ureq::get(&status_url).call() {
				eprintln!("status failed: {e}");
				std::process::exit(1);
			}
		}
	}
}

fn helper_url() -> String {
	std::env::var("_2CODE_HELPER_URL").expect("_2CODE_HELPER_URL not set")
}

fn session_id() -> Option<String> {
	std::env::var("_2CODE_SESSION_ID")
		.ok()
		.filter(|sid| !sid.is_empty())
}
