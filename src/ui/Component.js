import { EventBus } from '../core/EventBus.js';

/**
 * Base Component class for UI elements.
 * Provides a structured way to build, mount, and manage DOM elements.
 * Facilitates the Open/Closed principle by allowing extension without modifying core code.
 */
export class Component {
  constructor(id, className = '') {
    this.id = id;
    this.className = className;
    this.element = null;
    this.subscriptions = [];
  }

  /**
   * Abstract method to be implemented by subclasses.
   * Should construct and return a DOM element.
   * @returns {HTMLElement}
   */
  render() {
    const el = document.createElement('div');
    if (this.id) el.id = this.id;
    if (this.className) el.className = this.className;
    return el;
  }

  /**
   * Mounts the component into a parent element.
   * @param {HTMLElement} parentElement 
   */
  mount(parentElement) {
    if (!this.element) {
      this.element = this.render();
    }
    parentElement.appendChild(this.element);
    this.onMount();
  }

  /**
   * Unmounts the component and cleans up listeners.
   */
  unmount() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.subscriptions.forEach(unsub => unsub());
    this.subscriptions = [];
    this.onUnmount();
  }

  /**
   * Subscribe to global events.
   * @param {string} event 
   * @param {Function} callback 
   */
  subscribe(event, callback) {
    const unsub = EventBus.on(event, callback);
    this.subscriptions.push(unsub);
  }

  // --- Lifecycle Hooks ---
  onMount() {}
  onUnmount() {}
}
