use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type")]
pub enum ReaderSessionEffect {
    #[serde(rename = "cancelTimer")]
    CancelTimer,
    #[serde(rename = "scheduleTick")]
    ScheduleTick {
        generation: u64,
        #[serde(rename = "delayMs")]
        delay_ms: u64,
    },
}
