// events.js
export const bus = new EventTarget();
export const emitStateChanged = () => bus.dispatchEvent(new Event('statechanged'));
