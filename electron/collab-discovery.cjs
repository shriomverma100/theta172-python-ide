/**
 * THETA172 — Collab mDNS Discovery
 * Runs inside Electron main process (Node.js / CJS).
 *
 * Uses bonjour-service for zero-config service discovery.
 * When a sharer goes live, they publish a "_theta172._tcp" service.
 * Viewers browse for nearby services and see them in the "Nearby" list.
 *
 * Features:
 *   - Publish service when sharing (advertise room key + port)
 *   - Browse for nearby sharers (auto-discover on LAN)
 *   - Debounced updates to renderer
 *   - Clean unpublish on stop
 *   - Hostname resolution
 */

const Bonjour = require('bonjour-service');
const os = require('os');
const fs = require('fs');
const path = require('path');


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** mDNS service type for THETA172 collab */
const SERVICE_TYPE = 'theta172';

/** mDNS protocol */
const SERVICE_PROTOCOL = 'tcp';

/** Full service type string */
const FULL_SERVICE_TYPE = `_${SERVICE_TYPE}._${SERVICE_PROTOCOL}`;

/** Debounce interval for sending updates to renderer (ms) */
const UPDATE_DEBOUNCE = 500;

/** How often to re-scan for services (ms) */
const RESCAN_INTERVAL = 10000;


// ══════════════════════════════════════════════════════════════════
// DISCOVERY CLASS
// ══════════════════════════════════════════════════════════════════

class CollabDiscovery {
  constructor() {
    /** @type {Bonjour.Bonjour | null} */
    this.bonjour = null;

    /** @type {Object | null} - Published service instance */
    this.publishedService = null;

    /** @type {Object | null} - Active browser instance */
    this.browser = null;

    /** @type {Map<string, Object>} - Discovered services keyed by unique ID */
    this.discoveredServices = new Map();

    /** @type {boolean} */
    this.publishing = false;

    /** @type {boolean} */
    this.browsing = false;

    /** @type {NodeJS.Timer | null} */
    this.updateDebounceTimer = null;

    /** @type {NodeJS.Timer | null} */
    this.rescanTimer = null;

    /** @type {Function | null} - Callback when nearby devices change */
    this.onDevicesChanged = null;

    /** @type {string} - This machine's hostname */
    this.hostname = os.hostname() || 'Unknown';

    /** @type {string} - Our own host ID to filter out self-discovery */
    this.ownHostId = '';

    /** @type {string} - Path to local registry for single-machine testing */
    this.registryPath = path.join(os.tmpdir(), 'theta172-collab-registry.json');
  }


  // ── LOCAL REGISTRY (SINGLE-LAPTOP FALLBACK) ───────────────────

  _readRegistry() {
    try {
      if (fs.existsSync(this.registryPath)) {
        const data = fs.readFileSync(this.registryPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (_) {}
    return {};
  }

  _writeRegistry(data) {
    try {
      fs.writeFileSync(this.registryPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn('[DISCOVERY] Failed to write local registry:', err.message);
    }
  }

  _publishLocal(options, addresses) {
    const reg = this._readRegistry();
    // Use the first real non-loopback address as host, fallback to 127.0.0.1
    const realHost = addresses.find(a => a && !a.startsWith('127.')) || '127.0.0.1';
    reg[this.ownHostId] = {
      id: `local-${options.port}-${this.ownHostId}`,
      name: options.hostName || this.hostname,
      roomKey: options.roomKey,
      host: realHost,
      addresses: addresses,
      port: options.port,
      meta: `${realHost}:${options.port}`,
      platform: process.platform,
      version: '1',
      discoveredAt: Date.now(),
      timestamp: Date.now()
    };
    // Clean up stale entries (older than 1 hour)
    for (const key of Object.keys(reg)) {
      if (Date.now() - reg[key].timestamp > 3600000) {
        delete reg[key];
      }
    }
    this._writeRegistry(reg);
  }

  _unpublishLocal() {
    if (!this.ownHostId) return;
    const reg = this._readRegistry();
    if (reg[this.ownHostId]) {
      delete reg[this.ownHostId];
      this._writeRegistry(reg);
    }
  }

  _scanLocal() {
    const reg = this._readRegistry();
    for (const [key, svc] of Object.entries(reg)) {
      if (key === this.ownHostId) continue;
      // If it hasn't been updated in 1 hour, assume dead
      if (Date.now() - svc.timestamp > 3600000) continue;
      
      this.discoveredServices.set(svc.id, svc);
    }
    this.scheduleUpdate();
  }


  // ── INITIALIZE ────────────────────────────────────────────────

  /**
   * Initialize the bonjour instance.
   * Call this once on app startup.
   */
  init() {
    try {
      this.bonjour = new Bonjour.Bonjour();
      console.log('[DISCOVERY] mDNS initialized');
    } catch (err) {
      console.error('[DISCOVERY] Failed to init mDNS:', err.message);
      this.bonjour = null;
    }
  }


  // ── PUBLISH (SHARER) ─────────────────────────────────────────

  /**
   * Publish this machine as a THETA172 collab host.
   * Called when the sharer clicks "Go Live".
   *
   * @param {Object} options
   * @param {number} options.port     - WebSocket server port
   * @param {string} options.roomKey  - Room key (e.g., "T72-K9X")
   * @param {string} options.hostName - Sharer's display name
   * @param {string} options.hostId   - Unique host identifier
   */
  publish(options) {
    if (!this.bonjour) {
      console.warn('[DISCOVERY] mDNS not available, skipping publish');
      return;
    }

    // Unpublish any existing service first
    this.unpublish();

    this.ownHostId = options.hostId || '';

    try {
      this.publishedService = this.bonjour.publish({
        name: `THETA172-${options.roomKey}`,
        type: SERVICE_TYPE,
        protocol: SERVICE_PROTOCOL,
        port: options.port,
        txt: {
          roomKey: options.roomKey,
          hostName: options.hostName || this.hostname,
          hostId: options.hostId || '',
          version: '1',
          platform: process.platform,
        },
      });

      this.publishing = true;

      // Collect all valid local IPv4 addresses for the registry
      const ifaces = os.networkInterfaces();
      const localAddresses = [];
      for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
          if (!iface.internal && iface.family === 'IPv4') {
            localAddresses.push(iface.address);
          }
        }
      }
      // Always include 127.0.0.1 as a last resort for same-machine fallback
      localAddresses.push('127.0.0.1');
      this._publishLocal(options, localAddresses);

      console.log(`[DISCOVERY] Published service: ${SERVICE_TYPE} on port ${options.port} (room: ${options.roomKey})`);
    } catch (err) {
      console.error('[DISCOVERY] Publish error:', err.message);
    }
  }


  /**
   * Unpublish the service.
   * Called when the sharer clicks "Stop Sharing".
   */
  unpublish() {
    this._unpublishLocal();
    if (this.publishedService) {
      try {
        this.publishedService.stop(() => {
          console.log('[DISCOVERY] Service unpublished');
        });
      } catch (err) {
        console.error('[DISCOVERY] Unpublish error:', err.message);
      }
      this.publishedService = null;
    }
    this.publishing = false;
  }


  // ── BROWSE (VIEWER) ───────────────────────────────────────────

  /**
   * Start browsing for nearby THETA172 collab services.
   * Called when the viewer panel opens.
   */
  startBrowsing() {
    // Scan local registry immediately as a fast fallback
    this._scanLocal();

    if (!this.bonjour) {
      console.warn('[DISCOVERY] mDNS not available, falling back to local registry only');
      return;
    }

    // Stop any existing browser
    this.stopBrowsing();

    this.discoveredServices.clear();
    this._scanLocal(); // scan again after clear
    this.browsing = true;

    try {
      this.browser = this.bonjour.find({
        type: SERVICE_TYPE,
        protocol: SERVICE_PROTOCOL,
      });

      this.browser.on('up', (service) => {
        this.handleServiceUp(service);
      });

      this.browser.on('down', (service) => {
        this.handleServiceDown(service);
      });

      console.log('[DISCOVERY] Browsing for nearby services...');

      // Periodic rescan to catch services that appeared silently
      this.rescanTimer = setInterval(() => {
        this._scanLocal();
        if (this.browser && this.browsing) {
          try {
            this.browser.update();
          } catch (_) {}
        }
      }, RESCAN_INTERVAL);

    } catch (err) {
      console.error('[DISCOVERY] Browse error:', err.message);
      this.browsing = false;
    }
  }


  /**
   * Stop browsing for services.
   */
  stopBrowsing() {
    if (this.browser) {
      try {
        this.browser.stop();
      } catch (err) {
        console.error('[DISCOVERY] Stop browse error:', err.message);
      }
      this.browser = null;
    }

    if (this.rescanTimer) {
      clearInterval(this.rescanTimer);
      this.rescanTimer = null;
    }

    this.browsing = false;
    this.discoveredServices.clear();
  }


  // ── SERVICE HANDLERS ──────────────────────────────────────────

  /**
   * Handle a new service discovered on the network.
   */
  handleServiceUp(service) {
    // Extract TXT record data
    const txt = service.txt || {};
    const roomKey = txt.roomKey || '';
    const hostName = txt.hostName || service.name || 'Unknown';
    const hostId = txt.hostId || '';

    // Filter out our own service
    if (hostId && hostId === this.ownHostId) {
      return;
    }

    // Build a unique service ID
    const serviceId = `${service.name}-${service.port}-${hostId}`;

    // Get all valid IPv4 addresses (non-loopback)
    const addresses = this.getAllValidAddresses(service);
    const host = addresses.length > 0 ? addresses[0] : 'localhost';

    const deviceInfo = {
      id: serviceId,
      name: hostName,
      roomKey: roomKey,
      host: host, // Fallback for old code
      addresses: addresses, // Array of all possible IPs to try
      port: service.port,
      meta: `${host}:${service.port}`,
      platform: txt.platform || 'unknown',
      version: txt.version || '1',
      discoveredAt: Date.now(),
    };

    this.discoveredServices.set(serviceId, deviceInfo);

    console.log(`[DISCOVERY] Service UP: ${hostName} (${roomKey}) at ${host}:${service.port} (Available IPs: ${addresses.join(', ')})`);

    // Debounced update to renderer
    this.scheduleUpdate();
  }


  /**
   * Handle a service going down (host stopped sharing).
   */
  handleServiceDown(service) {
    const txt = service.txt || {};
    const hostId = txt.hostId || '';
    const hostName = txt.hostName || service.name || 'Unknown';

    // Find and remove the service
    let removedKey = null;
    for (const [key, svc] of this.discoveredServices) {
      if (key.includes(service.name) || (hostId && key.includes(hostId))) {
        removedKey = key;
        break;
      }
    }

    if (removedKey) {
      this.discoveredServices.delete(removedKey);
      console.log(`[DISCOVERY] Service DOWN: ${hostName}`);
      this.scheduleUpdate();
    }
  }


  /**
   * Get all valid IPv4 addresses from a service record.
   * Filters out localhost to prevent local loopback issues across devices.
   */
  getAllValidAddresses(service) {
    const addresses = service.addresses || [];

    // Return all valid IPv4 addresses that aren't loopback
    const validIps = addresses.filter((addr) =>
      addr && !addr.includes(':') && !addr.startsWith('127.')
    );

    if (validIps.length > 0) return validIps;

    // Fallback to hostname if no IPs found
    if (service.host) return [service.host];

    return [];
  }


  // ── UPDATE NOTIFICATIONS ──────────────────────────────────────

  /**
   * Schedule a debounced update to the renderer.
   * Prevents flooding the IPC channel when multiple services appear/disappear.
   */
  scheduleUpdate() {
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }

    this.updateDebounceTimer = setTimeout(() => {
      this.updateDebounceTimer = null;
      this.notifyRenderer();
    }, UPDATE_DEBOUNCE);
  }


  /**
   * Send the current device list to the renderer.
   */
  notifyRenderer() {
    const devices = this.getDeviceList();

    if (this.onDevicesChanged) {
      this.onDevicesChanged(devices);
    }
  }


  /**
   * Get a clean list of discovered devices for the renderer.
   */
  getDeviceList() {
    const devices = [];

    for (const [, svc] of this.discoveredServices) {
      devices.push({
        id: svc.id,
        name: svc.name,
        roomKey: svc.roomKey,
        host: svc.host,
        port: svc.port,
        meta: svc.meta,
        platform: svc.platform,
      });
    }

    // Sort by discovery time (newest first)
    devices.sort((a, b) => {
      const svcA = this.discoveredServices.get(a.id);
      const svcB = this.discoveredServices.get(b.id);
      return (svcB?.discoveredAt || 0) - (svcA?.discoveredAt || 0);
    });

    return devices;
  }


  // ── CLEANUP ───────────────────────────────────────────────────

  /**
   * Destroy everything. Call on app quit.
   */
  destroy() {
    this.unpublish();
    this.stopBrowsing();

    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
      this.updateDebounceTimer = null;
    }

    if (this.bonjour) {
      try {
        this.bonjour.destroy();
      } catch (err) {
        console.error('[DISCOVERY] Destroy error:', err.message);
      }
      this.bonjour = null;
    }

    console.log('[DISCOVERY] Destroyed');
  }
}


// ── SINGLETON EXPORT ────────────────────────────────────────────

module.exports = { CollabDiscovery };
