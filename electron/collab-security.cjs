/**
 * THETA172 — Collab Security (Server-side)
 * Runs in Electron main process (CJS).
 *
 * Features:
 *   - Room password hashing (SHA-256)
 *   - Connection rate limiting (per IP)
 *   - Brute-force protection (failed attempts lockout)
 *   - Input sanitization
 *   - Message size enforcement
 *   - Connection attempt throttling
 */

const crypto = require('crypto');


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** Max failed auth attempts before lockout */
const MAX_FAILED_ATTEMPTS = 5;

/** Lockout duration after max failed attempts (ms) — 5 minutes */
const LOCKOUT_DURATION = 5 * 60 * 1000;

/** Rate limit window (ms) — 1 minute */
const RATE_LIMIT_WINDOW = 60 * 1000;

/** Max connection attempts per IP per window */
const MAX_CONNECTIONS_PER_WINDOW = 10;

/** Max message size (bytes) — 1MB */
const MAX_MESSAGE_SIZE = 1024 * 1024;

/** Max name length */
const MAX_NAME_LENGTH = 64;

/** Max password length */
const MAX_PASSWORD_LENGTH = 128;

/** Salt length for password hashing (bytes) */
const SALT_LENGTH = 16;

/** Password hash iterations */
const HASH_ITERATIONS = 10000;

/** Password hash key length (bytes) */
const HASH_KEY_LENGTH = 32;


// ══════════════════════════════════════════════════════════════════
// SECURITY MANAGER
// ══════════════════════════════════════════════════════════════════

class CollabSecurity {
  constructor() {
    /**
     * Connection attempts per IP.
     * @type {Map<string, { count: number, firstAttempt: number }>}
     */
    this._connectionAttempts = new Map();

    /**
     * Failed auth attempts per IP.
     * @type {Map<string, { count: number, firstAttempt: number, lockedUntil: number }>}
     */
    this._failedAttempts = new Map();

    /**
     * Hashed room password (null = no password).
     * @type {{ hash: string, salt: string } | null}
     */
    this._roomPassword = null;

    /**
     * Cleanup timer for stale rate-limit entries.
     * @type {NodeJS.Timer | null}
     */
    this._cleanupTimer = null;

    // Start periodic cleanup of stale entries
    this._cleanupTimer = setInterval(() => {
      this._cleanupStaleEntries();
    }, RATE_LIMIT_WINDOW);
  }


  // ── PASSWORD MANAGEMENT ───────────────────────────────────────

  /**
   * Set the room password.
   * @param {string | null} password - Plain text password (null to disable)
   */
  setRoomPassword(password) {
    if (!password || password.trim() === '') {
      this._roomPassword = null;
      console.log('[SECURITY] Room password disabled');
      return;
    }

    const sanitized = password.substring(0, MAX_PASSWORD_LENGTH).trim();
    const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    const hash = this._hashPassword(sanitized, salt);

    this._roomPassword = { hash, salt };
    console.log('[SECURITY] Room password set');
  }

  /**
   * Check if a room password is set.
   * @returns {boolean}
   */
  hasPassword() {
    return this._roomPassword !== null;
  }

  /**
   * Verify a password against the stored hash.
   * @param {string} password - Plain text password to verify
   * @returns {boolean}
   */
  verifyPassword(password) {
    if (!this._roomPassword) return true; // No password set = always pass

    if (!password || typeof password !== 'string') return false;

    const sanitized = password.substring(0, MAX_PASSWORD_LENGTH).trim();
    const hash = this._hashPassword(sanitized, this._roomPassword.salt);

    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(this._roomPassword.hash, 'hex')
    );
  }

  /**
   * Hash a password with a salt using PBKDF2.
   * @param {string} password
   * @param {string} salt
   * @returns {string} Hex-encoded hash
   */
  _hashPassword(password, salt) {
    return crypto.pbkdf2Sync(
      password,
      salt,
      HASH_ITERATIONS,
      HASH_KEY_LENGTH,
      'sha256'
    ).toString('hex');
  }


  // ── RATE LIMITING ─────────────────────────────────────────────

  /**
   * Check if a connection from an IP is allowed (rate limiting).
   * @param {string} ip - Remote IP address
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkConnectionRate(ip) {
    const normalizedIp = this._normalizeIp(ip);
    const now = Date.now();

    // Check if IP is locked out from brute force
    const failedEntry = this._failedAttempts.get(normalizedIp);
    if (failedEntry && failedEntry.lockedUntil > now) {
      const remainingMs = failedEntry.lockedUntil - now;
      const remainingSec = Math.ceil(remainingMs / 1000);
      return {
        allowed: false,
        reason: `Too many failed attempts. Try again in ${remainingSec}s`,
      };
    }

    // Check connection rate limit
    let entry = this._connectionAttempts.get(normalizedIp);

    if (!entry || (now - entry.firstAttempt) > RATE_LIMIT_WINDOW) {
      // New window
      entry = { count: 1, firstAttempt: now };
      this._connectionAttempts.set(normalizedIp, entry);
      return { allowed: true };
    }

    entry.count++;

    if (entry.count > MAX_CONNECTIONS_PER_WINDOW) {
      return {
        allowed: false,
        reason: 'Too many connection attempts. Please wait.',
      };
    }

    return { allowed: true };
  }


  // ── BRUTE FORCE PROTECTION ────────────────────────────────────

  /**
   * Record a failed auth attempt from an IP.
   * @param {string} ip - Remote IP address
   */
  recordFailedAttempt(ip) {
    const normalizedIp = this._normalizeIp(ip);
    const now = Date.now();

    let entry = this._failedAttempts.get(normalizedIp);

    if (!entry || (now - entry.firstAttempt) > LOCKOUT_DURATION) {
      // New tracking period
      entry = { count: 1, firstAttempt: now, lockedUntil: 0 };
      this._failedAttempts.set(normalizedIp, entry);
      return;
    }

    entry.count++;

    if (entry.count >= MAX_FAILED_ATTEMPTS) {
      entry.lockedUntil = now + LOCKOUT_DURATION;
      console.warn(`[SECURITY] IP ${normalizedIp} locked out for ${LOCKOUT_DURATION / 1000}s after ${MAX_FAILED_ATTEMPTS} failed attempts`);
    }
  }

  /**
   * Clear failed attempt tracking for an IP (on successful auth).
   * @param {string} ip
   */
  clearFailedAttempts(ip) {
    const normalizedIp = this._normalizeIp(ip);
    this._failedAttempts.delete(normalizedIp);
  }


  // ── INPUT SANITIZATION ────────────────────────────────────────

  /**
   * Sanitize a viewer name.
   * @param {string} name - Raw viewer name
   * @returns {string} Sanitized name
   */
  sanitizeName(name) {
    if (!name || typeof name !== 'string') return 'Anonymous';

    // Trim, limit length, remove control characters
    let clean = name
      .substring(0, MAX_NAME_LENGTH)
      .trim()
      .replace(/[\x00-\x1F\x7F]/g, '')    // Remove control chars
      .replace(/[<>"'&\\]/g, '')            // Remove HTML-dangerous chars
      .replace(/\s+/g, ' ');                // Normalize whitespace

    return clean || 'Anonymous';
  }

  /**
   * Sanitize a room key.
   * @param {string} key - Raw room key
   * @returns {string} Sanitized key (uppercase)
   */
  sanitizeRoomKey(key) {
    if (!key || typeof key !== 'string') return '';

    return key
      .toUpperCase()
      .trim()
      .replace(/[^A-Z0-9-]/g, '')
      .substring(0, 10);
  }

  /**
   * Sanitize a chat/annotation message.
   * @param {string} text - Raw text
   * @param {number} maxLength - Max allowed length
   * @returns {string} Sanitized text
   */
  sanitizeText(text, maxLength) {
    if (!text || typeof text !== 'string') return '';

    const limit = maxLength || 500;

    return text
      .substring(0, limit)
      .trim()
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars (keep \n, \r, \t)
      .replace(/[<>]/g, (c) => c === '<' ? '&lt;' : '&gt;'); // Escape HTML brackets
  }


  // ── MESSAGE VALIDATION ────────────────────────────────────────

  /**
   * Validate an incoming WebSocket message.
   * @param {Buffer | string} rawData - Raw message data
   * @returns {{ valid: boolean, reason?: string }}
   */
  validateMessage(rawData) {
    // Size check
    const size = typeof rawData === 'string'
      ? Buffer.byteLength(rawData, 'utf8')
      : rawData.length;

    if (size > MAX_MESSAGE_SIZE) {
      return { valid: false, reason: `Message too large: ${size} bytes (max ${MAX_MESSAGE_SIZE})` };
    }

    if (size === 0) {
      return { valid: false, reason: 'Empty message' };
    }

    // JSON parse check
    try {
      const str = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
      const parsed = JSON.parse(str);

      if (!parsed || typeof parsed !== 'object') {
        return { valid: false, reason: 'Message is not a JSON object' };
      }

      if (!parsed.type || typeof parsed.type !== 'string') {
        return { valid: false, reason: 'Missing or invalid message type' };
      }

      if (parsed.type.length > 50) {
        return { valid: false, reason: 'Message type too long' };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, reason: 'Invalid JSON' };
    }
  }


  // ── HELPERS ───────────────────────────────────────────────────

  /**
   * Normalize an IP address (handle IPv6-mapped IPv4, etc.).
   * @param {string} ip
   * @returns {string}
   */
  _normalizeIp(ip) {
    if (!ip) return 'unknown';

    // Convert IPv6-mapped IPv4 (::ffff:127.0.0.1 → 127.0.0.1)
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }

    return ip;
  }

  /**
   * Clean up stale rate-limit and lockout entries.
   */
  _cleanupStaleEntries() {
    const now = Date.now();

    // Clean connection attempts
    for (const [ip, entry] of this._connectionAttempts) {
      if ((now - entry.firstAttempt) > RATE_LIMIT_WINDOW * 2) {
        this._connectionAttempts.delete(ip);
      }
    }

    // Clean failed attempts (but keep locked entries until lockout expires)
    for (const [ip, entry] of this._failedAttempts) {
      if (entry.lockedUntil > 0 && entry.lockedUntil < now) {
        this._failedAttempts.delete(ip);
      } else if ((now - entry.firstAttempt) > LOCKOUT_DURATION * 2) {
        this._failedAttempts.delete(ip);
      }
    }
  }

  /**
   * Reset all security state (on server stop).
   */
  reset() {
    this._connectionAttempts.clear();
    this._failedAttempts.clear();
    this._roomPassword = null;
  }

  /**
   * Destroy the security manager.
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.reset();
  }
}


// ── EXPORT ──────────────────────────────────────────────────────

module.exports = { CollabSecurity };
