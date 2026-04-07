type Listener = (...args: any[]) => void;

/**
 * A minimal typed event emitter for decoupling core ↔ UI.
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
    // Return unsubscribe function
    return () => this.listeners.get(event)?.delete(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach(fn => fn(...args));
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Event names used by the application. */
export const Events = {
  // VM → UI
  VM_STATE_CHANGED: 'vm:state-changed',
  VM_OUTPUT: 'vm:output',
  VM_ERROR: 'vm:error',
  VM_STEP: 'vm:step',

  // UI → VM
  INPUT_PROVIDED: 'input:provided',

  // Editor
  SOURCE_CHANGED: 'editor:source-changed',
  BREAKPOINT_TOGGLED: 'editor:breakpoint-toggled',

  // Parse
  PARSE_ERRORS: 'parse:errors',
} as const;
