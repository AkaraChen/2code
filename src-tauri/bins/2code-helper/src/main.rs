use clap::{Parser, Subcommand};
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

#[derive(Subcommand)]
enum Commands {
	/// Trigger a notification sound
	Notify,
}

fn main() {
	let cli = Cli::parse();
	match cli.command {
		Commands::Notify => {
			let url = std::env::var("_2CODE_HELPER_URL")
				.expect("_2CODE_HELPER_URL not set");
			let notify_url = match std::env::var("_2CODE_SESSION_ID").ok() {
				Some(sid) => format!("{url}/notify?session_id={sid}"),
				None => format!("{url}/notify"),
			};
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
	}
}
