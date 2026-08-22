use wasm_bindgen::prelude::*;

use crate::{ReaderSessionCommand, ReaderSessionState, initial_state, reduce};

fn encode<T: serde::Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, JsValue> {
    serde_json::from_str(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn reader_session_create() -> Result<String, JsValue> {
    encode(&initial_state())
}

#[wasm_bindgen]
pub fn reader_session_dispatch(state_json: &str, command_json: &str) -> Result<String, JsValue> {
    let state: ReaderSessionState = decode(state_json)?;
    let command: ReaderSessionCommand = decode(command_json)?;
    encode(&reduce(&state, command))
}
