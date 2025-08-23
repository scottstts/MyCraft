/**
 * Simple EventEmitter for game events
 * Purpose: Provides basic pub/sub pattern for engine components
 * Callers: World, Chunk pipeline, and other systems that need event communication
 * Invariants: Type-safe event handling with proper cleanup
 */

export type EventListener<T = unknown> = (data: T) => void;

export class EventEmitter<EventMap extends Record<string, unknown> = Record<string, unknown>> {
  private listeners: Map<keyof EventMap, Set<EventListener<any>>> = new Map();

  /**
   * Add an event listener
   * @param event Event name
   * @param listener Callback function
   * @returns Function to remove the listener
   */
  on<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    
    const eventListeners = this.listeners.get(event)!;
    eventListeners.add(listener as EventListener<any>);

    // Return unsubscribe function
    return () => {
      eventListeners.delete(listener as EventListener<any>);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Add a one-time event listener
   * @param event Event name
   * @param listener Callback function
   * @returns Function to remove the listener
   */
  once<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): () => void {
    const removeListener = this.on(event, (data) => {
      removeListener();
      listener(data);
    });
    return removeListener;
  }

  /**
   * Remove an event listener
   * @param event Event name
   * @param listener Callback function to remove
   */
  off<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener as EventListener<any>);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event to all listeners
   * @param event Event name
   * @param data Event data
   */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      // Create a copy to avoid issues if listeners are modified during emission
      const listenersArray = Array.from(eventListeners);
      for (const listener of listenersArray) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for '${String(event)}':`, error);
        }
      }
    }
  }

  /**
   * Remove all listeners for an event (or all events if no event specified)
   * @param event Optional event name. If not provided, removes all listeners
   */
  removeAllListeners<K extends keyof EventMap>(event?: K): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for an event
   * @param event Event name
   * @returns Number of listeners
   */
  listenerCount<K extends keyof EventMap>(event: K): number {
    const eventListeners = this.listeners.get(event);
    return eventListeners ? eventListeners.size : 0;
  }

  /**
   * Get all event names that have listeners
   * @returns Array of event names
   */
  eventNames(): Array<keyof EventMap> {
    return Array.from(this.listeners.keys());
  }
}