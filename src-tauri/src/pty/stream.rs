use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct PtyOutput {
    pub data: Vec<u8>,
}
