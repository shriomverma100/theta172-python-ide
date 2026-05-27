/**
 * Abstract interface for collaboration connection protocols.
 * Enforces Liskov Substitution Principle so orchestrator (collab.js)
 * doesn't need to know if it's using WebSockets, WebRTC, or Relay.
 * 
 * @interface
 */
export class IConnection {
  /**
   * Connect to a specific host/port with a room key.
   * @param {Object} options 
   * @param {string} [options.host]
   * @param {number} [options.port]
   * @param {string} [options.roomKey]
   * @param {string} [options.relayUrl]
   * @param {string} [options.clientId]
   * @param {string} [options.name]
   * @param {string} [options.password]
   * @returns {Promise<void>} Resolves when connection succeeds
   */
  async connect(options) {
    throw new Error('Not implemented');
  }

  /**
   * Disconnect and clean up resources.
   */
  destroy() {
    throw new Error('Not implemented');
  }

  /**
   * Send a JSON message to the server.
   * @param {Object} message 
   */
  sendMessage(message) {
    throw new Error('Not implemented');
  }

  // --- Callbacks that must be overridden by the implementer ---
  
  /** @type {(msg: Object) => void} */
  onMessage = () => {};
  
  /** @type {(info: Object) => void} */
  onConnected = () => {};
  
  /** @type {(info: Object) => void} */
  onDisconnected = () => {};
  
  /** @type {(error: Error) => void} */
  onError = () => {};
}
