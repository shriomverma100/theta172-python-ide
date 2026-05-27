import { EventBus } from '../core/EventBus.js';

/**
 * Global application state store.
 * Updates trigger EventBus events to keep UI reactive without tight coupling.
 */
class AppStore {
  constructor() {
    this.state = {
      // Collab State
      collabRole: 'idle', // 'idle' | 'sharer' | 'viewer'
      collabStatus: 'disconnected', // 'disconnected' | 'sharing' | 'viewing'
      roomKey: null,
      directConnectUrl: null,
      viewers: [],
      
      // UI State
      isPanelOpen: false,
      theme: 'dark',
      
      // Editor State
      activeFile: null,
    };
  }

  /**
   * Get the current state.
   * @returns {Object} Read-only state copy
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Update state and notify subscribers.
   * @param {Object} partialState 
   */
  setState(partialState) {
    const prevState = { ...this.state };
    this.state = { ...this.state, ...partialState };
    
    // Emit global state change
    EventBus.emit('STATE_CHANGED', { prev: prevState, current: this.state });

    // Emit specific sub-events for targeted listeners
    if (partialState.collabStatus !== undefined && partialState.collabStatus !== prevState.collabStatus) {
      EventBus.emit('COLLAB_STATUS_CHANGED', this.state.collabStatus);
    }
    if (partialState.viewers !== undefined) {
      EventBus.emit('VIEWERS_CHANGED', this.state.viewers);
    }
  }
}

export const Store = new AppStore();
