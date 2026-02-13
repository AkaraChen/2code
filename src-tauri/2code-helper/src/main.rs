use clap::{Parser, Subcommand};

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
			match ureq::get(&format!("{url}/notify")).call() {
				Ok(mut resp) => {
					let body: shared::NotifyResponse = resp
						.body_mut()
						.read_json()
						.unwrap_or(shared::NotifyResponse { played: false });
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
