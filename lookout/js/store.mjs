// Lookout · store: a tiny topic-based state container shared by the views.

const state = {
  health: null,          // normalized Health | null
  healthError: null,     // ApiError | null
  posture: null,
  job: null,             // normalized Job | null
  jobInput: null,        // masked projection of the submitted batch (never raw PANs)
  jobSource: null,       // { kind: 'sample' | 'paste' | 'file' | 'demo', label }
  batchBusy: false,
  ledgerBusy: false,     // a verify or tamper is in flight
  batchError: null,
  lastTamper: null,      // { seq, mode, before, after, at }
  verificationStale: false,
  siege: new Map(),      // scenario id -> { state, outcome?, error? }
  siegeRun: null,        // { running, done, total, startedAt, finishedAt }
  report: null,
  reportError: null,
  examples: null,
  scanner: null,         // { source, filename, language, format }
  replayToken: 0,        // bumps when the fortress should replay its animation
};

const listeners = new Map();

export const store = {
  get(key) {
    return state[key];
  },
  set(key, value) {
    state[key] = value;
    this.emit(key);
  },
  patch(values) {
    for (const [key, value] of Object.entries(values)) state[key] = value;
    for (const key of Object.keys(values)) this.emit(key);
  },
  emit(key) {
    for (const fn of listeners.get(key) ?? []) {
      try {
        fn(state[key]);
      } catch (error) {
        console.error(error);
      }
    }
  },
  /** Subscribe to one or more keys; returns an unsubscribe function. */
  on(keys, fn) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
    }
    return () => list.forEach((key) => listeners.get(key)?.delete(fn));
  },
};
