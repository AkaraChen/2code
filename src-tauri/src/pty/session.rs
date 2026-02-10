use portable_pty::{Child, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tokio::task::AbortHandle;

pub const OUTPUT_BUFFER_CAPACITY: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyConfig {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

impl Default for PtyConfig {
    fn default() -> Self {
        Self {
            shell: None,
            cwd: None,
            env: None,
            rows: Some(24),
            cols: Some(80),
        }
    }
}

impl PtyConfig {
    pub fn rows(&self) -> u16 {
        self.rows.unwrap_or(24)
    }

    pub fn cols(&self) -> u16 {
        self.cols.unwrap_or(80)
    }

    pub fn shell_or_default(&self) -> String {
        self.shell.clone().unwrap_or_else(|| {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        })
    }

    pub fn cwd_or_default(&self) -> String {
        self.cwd.clone().unwrap_or_else(|| {
            dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "/".to_string())
        })
    }

    pub fn pty_size(&self) -> PtySize {
        PtySize {
            rows: self.rows(),
            cols: self.cols(),
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PtySessionInfo {
    pub id: String,
    pub shell: String,
    pub cwd: String,
    pub rows: u16,
    pub cols: u16,
    pub created_at: u64,
}

pub struct PtySession {
    pub id: String,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub writer: Box<dyn Write + Send>,
    pub shell: String,
    pub cwd: String,
    pub rows: u16,
    pub cols: u16,
    pub created_at: SystemTime,
    pub output_buffer: VecDeque<Vec<u8>>,
    pub stream_abort: Option<AbortHandle>,
}

impl PtySession {
    pub fn info(&self) -> PtySessionInfo {
        let created_at = self
            .created_at
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        PtySessionInfo {
            id: self.id.clone(),
            shell: self.shell.clone(),
            cwd: self.cwd.clone(),
            rows: self.rows,
            cols: self.cols,
            created_at,
        }
    }

    pub fn push_output(&mut self, data: Vec<u8>) {
        if self.output_buffer.len() >= OUTPUT_BUFFER_CAPACITY {
            self.output_buffer.pop_front();
        }
        self.output_buffer.push_back(data);
    }
}

pub type PtySessionRegistry = Arc<Mutex<HashMap<String, PtySession>>>;

pub fn new_registry() -> PtySessionRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}
