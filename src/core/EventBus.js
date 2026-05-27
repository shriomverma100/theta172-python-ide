import Logger from './Logger.js';

/**
 * Centralized Event Bus (Pub/Sub pattern).
 * Used to decouple system components.
 */
class EventBusClass {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event 
   * @param {Function} callback 
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    return () => {
      this.off(event, callback);
    };
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event 
   * @param {Function} callback 
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event 
   * @param {any} payload 
   */
  emit(event, payload) {
    Logger.debug('EventBus', `Emit: ${event}`, payload);
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        try {
          callback(payload);
        } catch (err) {
          Logger.error('EventBus', `Error in listener for ${event}`, err);
        }
      }
    }
  }
}

export const EventBus = new EventBusClass();
