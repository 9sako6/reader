# reader-session

`reader-session` is the DOM-free state machine shared by the Chrome and Safari viewers. It owns preparation request races, playback, timer generations, reading-flow cursor movement, figures, mode changes, the current reading position, visibility pauses, and session destruction.

The crate is compiled as both an `rlib` for native tests and a `cdylib` for the browser WebAssembly build. Browser code supplies the final RSVP frame metadata, figures, and flow from one prepared document. Rust exposes each state machine as a wasm-bindgen `ReaderSession` class and returns serializable state transitions and effects. The facade under `browser/` owns WASM initialization, preparation state while initialization is pending, command queuing, timers, and object destruction; viewers only dispatch intent and render observed state.

Native model-based tests use the pinned Quint Connect release and the specification under `spec/`. The browser facade uses the wasm-bindgen exports generated from this same crate.
