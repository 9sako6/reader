use wasm_bindgen::prelude::*;

use crate::{ObservableState, ReaderSessionEffect};
use crate::{ReaderSessionCommand, ReaderSessionState, initial_state, reduce};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmTransition {
    state: ObservableState,
    effects: Vec<ReaderSessionEffect>,
}

fn encode<T: Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, JsValue> {
    serde_json::from_str(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = ReaderSession)]
pub struct WasmReaderSession {
    state: ReaderSessionState,
}

#[wasm_bindgen(js_class = ReaderSession)]
impl WasmReaderSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            state: initial_state(),
        }
    }

    pub fn observable(&self) -> Result<String, JsValue> {
        encode(&self.state.observable())
    }

    pub fn dispatch(&mut self, command_json: &str) -> Result<String, JsValue> {
        let command: ReaderSessionCommand = decode(command_json)?;
        let transition = reduce(&self.state, command);
        self.state = transition.state;
        encode(&WasmTransition {
            state: self.state.observable(),
            effects: transition.effects,
        })
    }
}

impl Default for WasmReaderSession {
    fn default() -> Self {
        Self::new()
    }
}
