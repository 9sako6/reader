use std::cell::RefCell;

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

thread_local! {
    static HANDLES: RefCell<Vec<Option<ReaderSessionState>>> = const { RefCell::new(Vec::new()) };
}

fn encode<T: Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, JsValue> {
    serde_json::from_str(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn invalid_handle() -> JsValue {
    JsValue::from_str("ReaderSession handle is closed or invalid")
}

#[wasm_bindgen]
pub fn reader_session_create() -> u32 {
    HANDLES.with(|handles| {
        let mut handles = handles.borrow_mut();
        if let Some((index, slot)) = handles
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.is_none())
        {
            *slot = Some(initial_state());
            return index as u32;
        }
        handles.push(Some(initial_state()));
        (handles.len() - 1) as u32
    })
}

#[wasm_bindgen]
pub fn reader_session_observable(handle: u32) -> Result<String, JsValue> {
    HANDLES.with(|handles| {
        let handles = handles.borrow();
        let state = handles
            .get(handle as usize)
            .and_then(Option::as_ref)
            .ok_or_else(invalid_handle)?;
        encode(&state.observable())
    })
}

#[wasm_bindgen]
pub fn reader_session_dispatch(handle: u32, command_json: &str) -> Result<String, JsValue> {
    let command: ReaderSessionCommand = decode(command_json)?;
    HANDLES.with(|handles| {
        let mut handles = handles.borrow_mut();
        let state = handles
            .get_mut(handle as usize)
            .and_then(Option::as_mut)
            .ok_or_else(invalid_handle)?;
        let transition = reduce(state, command);
        *state = transition.state;
        encode(&WasmTransition {
            state: state.observable(),
            effects: transition.effects,
        })
    })
}

#[wasm_bindgen]
pub fn reader_session_destroy(handle: u32) {
    HANDLES.with(|handles| {
        if let Some(slot) = handles.borrow_mut().get_mut(handle as usize) {
            *slot = None;
        }
    });
}
