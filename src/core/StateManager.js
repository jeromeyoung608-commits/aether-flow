// StateManager.js — tiny Pub/Sub store. The grid never reaches into the DOM
// directly for state changes; it mutates state and emits typed events that the
// renderer subscribes to. This is what keeps data and view cleanly separated.

export class StateManager {
  constructor(initialState = {}) {
    this.state = initialState;
    this._subs = new Map(); // event -> Set<handler>
  }

  /**
   * Subscribe to an event. Pass '*' to receive every emission
   * (handler receives eventName, payload, state).
   * @returns {Function} unsubscribe
   */
  subscribe(event, handler) {
    if (!this._subs.has(event)) this._subs.set(event, new Set());
    this._subs.get(event).add(handler);
    return () => this._subs.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const specific = this._subs.get(event);
    if (specific) {
      for (const handler of [...specific]) handler(payload, this.state);
    }
    const wildcard = this._subs.get('*');
    if (wildcard) {
      for (const handler of [...wildcard]) handler(event, payload, this.state);
    }
  }

  get(key) {
    return key == null ? this.state : this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    return this.state;
  }
}
