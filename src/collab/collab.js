/**
 * THETA172 — Collab Panel Module
 * Main orchestrator for the collaborative coding panel.
 *
 * Handles: panel lifecycle, role selection, state management,
 * room key generation, and animation orchestration.
 *
 * Design: Editorial Brutalist matching reference image.
 * Animation: All transitions at 120fps via GPU-accelerated CSS.
 */

import {
  buildTopbar,
  buildHeroSection,
  buildRoleCards,
  buildSharePanel,
  buildViewerPanel,
  buildHowItWorks,
  buildFooter,
  buildDeviceCard,
  buildViewerChip,
  buildDashboardTile,
} from './collab-ui.js';

import { showToast } from '../toast.js';
import { addRipple } from '../ripple.js';
import { CollabClient } from './collab-client.js';
import { StateCapture } from './state-capture.js';
import { StateRenderer } from './state-renderer.js';
import { TeacherDashboard } from './teacher-dashboard.js';
import { InteractionsManager } from './interactions.js';
import { ChatManager } from './chat.js';
import { CollabEditor } from './collab-editor.js';
import { CollabRelay } from './collab-relay.js';
import { getView as getEditorView, getValue as getEditorCode, setValue as setEditorCode } from '../editor.js';
import { EventBus } from '../core/EventBus.js';
import { Store } from '../store/Store.js';


// ══════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════

/** @type {'idle' | 'sharer' | 'viewer'} */
let collabRole = 'idle';

/** @type {'disconnected' | 'sharing' | 'viewing'} */
let collabStatus = 'disconnected';

/** @type {string | null} */
let currentRoomKey = null;
let currentDirectConnectUrl = null;

/** @type {boolean} */
let panelOpen = false;

/** @type {boolean} */
let panelBuilt = false;

/** @type {HTMLElement | null} */
let $collabPanel = null;

/** @type {Array<{id: string, name: string}>} */
let connectedViewers = [];

/** @type {Array<{id: string, name: string, meta: string}>} */
let nearbyDevices = [];

/** @type {string | null} */
let connectedToHost = null;

/** @type {Function | null} - Callback when live status changes */
let onLiveStatusChange = null;

/** @type {CollabClient | null} */
let collabClientInstance = null;

/** @type {Object | null} - Electron API reference */
let electronAPI = null;

/** @type {StateCapture | null} */
let stateCapture = null;

/** @type {StateRenderer | null} */
let stateRenderer = null;

/** @type {Object | null} - Editor state getters from main.js */
let editorGetters = null;

/** @type {TeacherDashboard | null} */
let teacherDashboard = null;

/** @type {InteractionsManager | null} */
let interactionsManager = null;

/** @type {ChatManager | null} */
let chatManager = null;

/** @type {CollabEditor | null} */
let collabEditor = null;

/** @type {CollabRelay | null} */
let collabRelay = null;

/** @type {'lan' | 'cloud'} */
let shareConnectionMode = 'lan';

/** @type {'lan' | 'cloud'} */
let viewerConnectionMode = 'lan';


// ══════════════════════════════════════════════════════════════════
// ROOM KEY GENERATION
// ══════════════════════════════════════════════════════════════════

/**
 * Generate a unique 6-character room key.
 * Format: T72-XXX where X is alphanumeric (uppercase).
 * Avoids ambiguous characters: 0/O, 1/I/L.
 */
function generateRoomKey() {
  const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const cryptoArray = new Uint8Array(3);
  crypto.getRandomValues(cryptoArray);
  for (let i = 0; i < 3; i++) {
    code += CHARS[cryptoArray[i] % CHARS.length];
  }
  return `T72-${code}`;
}


// ══════════════════════════════════════════════════════════════════
// DEVICE NAME
// ══════════════════════════════════════════════════════════════════

/**
 * Get a human-readable device name.
 * Uses hostname or a generated name from localStorage.
 */
function getDeviceName() {
  let name = localStorage.getItem('theta-collab-device-name');
  if (!name) {
    const adjectives = ['Swift', 'Bright', 'Bold', 'Sharp', 'Quick', 'Keen', 'Fast', 'Cool', 'Deep', 'Prime'];
    const nouns = ['Coder', 'Dev', 'Node', 'Pixel', 'Spark', 'Byte', 'Core', 'Flux', 'Forge', 'Stack'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 99) + 1;
    name = `${adj}${noun}${num}`;
    localStorage.setItem('theta-collab-device-name', name);
  }
  return name;
}


// ══════════════════════════════════════════════════════════════════
// PANEL LIFECYCLE
// ══════════════════════════════════════════════════════════════════

/**
 * Build the entire collab panel DOM.
 * Called once — subsequent opens just toggle visibility.
 */
function buildPanel() {
  $collabPanel = document.getElementById('collab-panel');
  if (!$collabPanel) {
    console.error('[COLLAB] Panel container #collab-panel not found');
    return;
  }

  // Clear any previous content
  $collabPanel.innerHTML = '';

  // ── Build all sections ──

  // 1. Top navigation bar
  const topbar = buildTopbar(closeCollabPanel);

  // 2. Hero section — "collab." large text
  const hero = buildHeroSection(scrollToRoles);

  // 3. Role selection cards — Share / View
  const roles = buildRoleCards(handleRoleSelect);

  // 4. Share panel (initially hidden)
  const sharePanel = buildSharePanel({
    onGoLive: handleGoLive,
    onStopSharing: handleStopSharing,
    onCopyKey: handleCopyKey,
    onToggleCollab: toggleCollabMode,
    onModeChange: (mode) => { shareConnectionMode = mode; },
  });

  // 5. Viewer panel (initially hidden)
  const viewerPanel = buildViewerPanel({
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    onViewerModeChange: (mode) => { viewerConnectionMode = mode; },
  });

  // 6. How it works
  const howItWorks = buildHowItWorks();

  // 7. Footer
  const footer = buildFooter();

  // ── Assemble ──
  $collabPanel.appendChild(topbar);
  $collabPanel.appendChild(hero);
  $collabPanel.appendChild(roles);
  $collabPanel.appendChild(sharePanel);
  $collabPanel.appendChild(viewerPanel);
  $collabPanel.appendChild(howItWorks);
  $collabPanel.appendChild(footer);

  // ── Add ripple to all buttons ──
  setTimeout(() => {
    $collabPanel.querySelectorAll('button').forEach(addRipple);
  }, 100);

  panelBuilt = true;
}


/**
 * Open the collab panel with a smooth slide-in animation.
 */
export function openCollabPanel() {
  if (panelOpen) return;

  if (!panelBuilt) {
    buildPanel();
  }

  if (!$collabPanel) return;

  panelOpen = true;

  // Remove hidden, reset closing state
  $collabPanel.classList.remove('hidden');
  $collabPanel.classList.remove('closing');

  // Force a reflow so the browser sees the non-hidden state
  // before we add the visible class (triggers the transition)
  void $collabPanel.offsetHeight;

  // Slide in
  requestAnimationFrame(() => {
    $collabPanel.classList.add('visible');
  });

  // Reset animations by removing and re-adding the hero section's animated elements
  resetHeroAnimations();

  // Trap focus inside panel
  setTimeout(() => {
    const backBtn = $collabPanel.querySelector('.collab-back-btn');
    backBtn?.focus();
  }, 400);
}


/**
 * Close the collab panel with a smooth slide-out animation.
 */
export function closeCollabPanel() {
  if (!panelOpen || !$collabPanel) return;

  panelOpen = false;

  // Stop mDNS browsing when panel closes
  stopDiscoveryBrowse();

  // Trigger slide-out
  $collabPanel.classList.remove('visible');
  $collabPanel.classList.add('closing');

  // After transition, hide completely
  const onTransitionEnd = () => {
    $collabPanel.classList.remove('closing');
    $collabPanel.classList.add('hidden');
    $collabPanel.removeEventListener('transitionend', onTransitionEnd);
  };

  $collabPanel.addEventListener('transitionend', onTransitionEnd, { once: true });

  // Fallback in case transitionend doesn't fire
  setTimeout(() => {
    if (!panelOpen && $collabPanel) {
      $collabPanel.classList.remove('closing');
      $collabPanel.classList.add('hidden');
    }
  }, 450);
}


/**
 * Toggle the collab panel open/closed.
 */
export function toggleCollabPanel() {
  if (panelOpen) {
    closeCollabPanel();
  } else {
    openCollabPanel();
  }
}


/**
 * Check if the collab panel is currently open.
 */
export function isCollabPanelOpen() {
  return panelOpen;
}


/**
 * Reset CSS animations on the hero section so they replay on re-open.
 */
function resetHeroAnimations() {
  if (!$collabPanel) return;

  const animatedElements = $collabPanel.querySelectorAll(
    '.collab-hero__title, .collab-hero__label, .collab-hero__subtitle, ' +
    '.collab-hero__number, .collab-hero__accent, .collab-hero__illustration, ' +
    '.collab-hero__vertical-text, .collab-hero__arrow, .collab-hero__dots, ' +
    '.collab-role-card, .collab-how__step'
  );

  animatedElements.forEach((el) => {
    // Remove animation temporarily
    const currentAnimation = el.style.animation;
    el.style.animation = 'none';

    // Force reflow
    void el.offsetHeight;

    // Restore animation
    el.style.animation = currentAnimation || '';
  });
}


// ══════════════════════════════════════════════════════════════════
// SCROLL HELPERS
// ══════════════════════════════════════════════════════════════════

function scrollToRoles() {
  const roles = document.getElementById('collab-roles');
  if (roles) {
    roles.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}


// ══════════════════════════════════════════════════════════════════
// ROLE SELECTION
// ══════════════════════════════════════════════════════════════════

function handleRoleSelect(role) {
  collabRole = role;
  Store.setState({ collabRole: role });

  // Update card active states
  const shareCard = document.getElementById('collab-role-share');
  const viewCard = document.getElementById('collab-role-view');

  if (role === 'sharer') {
    shareCard?.classList.add('active');
    viewCard?.classList.remove('active');
    showPanel('share');
    // Stop browsing when switching to share mode
    stopDiscoveryBrowse();
  } else {
    viewCard?.classList.add('active');
    shareCard?.classList.remove('active');
    showPanel('viewer');
    // Auto-start browsing for nearby devices
    startDiscoveryBrowse();
  }

  // Smooth scroll to the active panel
  setTimeout(() => {
    const panelId = role === 'sharer' ? 'collab-share-panel' : 'collab-viewer-panel';
    const panel = document.getElementById(panelId);
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}


/**
 * Show/hide the share and viewer panels.
 */
function showPanel(which) {
  const sharePanel = document.getElementById('collab-share-panel');
  const viewerPanel = document.getElementById('collab-viewer-panel');

  if (which === 'share') {
    sharePanel?.classList.add('visible');
    viewerPanel?.classList.remove('visible');
  } else if (which === 'viewer') {
    viewerPanel?.classList.add('visible');
    sharePanel?.classList.remove('visible');
  } else {
    sharePanel?.classList.remove('visible');
    viewerPanel?.classList.remove('visible');
  }
}


// ══════════════════════════════════════════════════════════════════
// SHARE MODE — Go Live / Stop Sharing
// ══════════════════════════════════════════════════════════════════

let _isGoingLive = false;

async function handleGoLive() {
  if (collabStatus === 'sharing') return;
  if (_isGoingLive) return; // Prevent double-click race
  _isGoingLive = true;

  currentRoomKey = generateRoomKey();
  const deviceName = getDeviceName();

  // Read optional password from the share panel
  const passwordInput = document.getElementById('collab-share-password');
  const roomPassword = passwordInput ? passwordInput.value.trim() : '';

  // Start WebSocket server via Electron IPC
  if (electronAPI && electronAPI.collabStartServer && shareConnectionMode === 'lan') {
    try {
      const result = await electronAPI.collabStartServer({
        roomKey: currentRoomKey,
        hostName: deviceName,
        hostId: crypto.randomUUID ? crypto.randomUUID() : `host-${Date.now()}`,
        password: roomPassword || undefined,
      });

      if (!result.success) {
        showToast(`Failed to go live: ${result.error}`, 'error', 3000);
        currentRoomKey = null;
        return;
      }

      collabStatus = 'sharing';
      connectedViewers = [];

      // Set direct connect URL
      const primaryIp = result.addresses && result.addresses.length > 0 ? result.addresses[0] : 'localhost';
      currentDirectConnectUrl = `${primaryIp}:${result.port}/${currentRoomKey}`;

      // Initialize Web Discovery Fallback for browser-to-browser
      if (!electronAPI || !electronAPI.collabStartServer) {
         initWebDiscovery();
      } else {
         // Also initialize it in electron just in case viewers are on the web via localhost proxy
         initWebDiscovery();
      }

      // Update UI
      updateShareUI();

      // Show server address info
      const addr = result.addresses && result.addresses.length > 0
        ? `${result.addresses[0]}:${result.port}`
        : `localhost:${result.port}`;

      // Notify the logo button to show LIVE indicator
      if (onLiveStatusChange) {
        onLiveStatusChange(true);
      }

      const lockStatus = result.hasPassword ? ' [LOCKED]' : ' [OPEN]';
      showToast(`Live on ${addr} -- Room: ${currentRoomKey}${lockStatus}`, 'success', 4000);

      // Start state capture engine
      startStateCapture();

      // Start interactions manager (teacher mode)
      startInteractions(true);

      // Start chat (teacher mode)
      startChat(true);

    } catch (err) {
      showToast(`Server error: ${err.message}`, 'error', 3000);
      currentRoomKey = null;
      _isGoingLive = false;
      return;
    }

    // ── Also register on the public relay so room key works from ANY network ──
    try {
      collabRelay = new CollabRelay();
      collabRelay.onRelayConnected = (info) => {
        console.log('[COLLAB] Room also registered on cloud relay');
      };
      collabRelay.onRelayDisconnected = (info) => {
        if (!info.intentional) {
          console.warn('[COLLAB] Lost cloud relay connection');
        }
      };
      collabRelay.onRelayError = (reason) => {
        console.warn('[COLLAB] Relay error (non-fatal):', reason);
      };
      // Forward relay messages to the local server logic
      collabRelay.onMessageReceived = (msg) => {
        handleRelayMessage(msg, true);
      };
      await collabRelay.connectAsHost({
        relayUrl: 'wss://theta172-relay.onrender.com',
        roomKey: currentRoomKey,
        hostName: deviceName,
      });
    } catch (relayErr) {
      // Relay is optional — LAN still works
      console.warn('[COLLAB] Could not register on relay (non-fatal):', relayErr.message);
      if (collabRelay) {
        collabRelay.destroy();
        collabRelay = null;
      }
    }

    _isGoingLive = false;
  } else if (shareConnectionMode === 'cloud') {
    // Cloud relay mode
    const relayUrlInput = document.getElementById('collab-share-relay-url');
    const relayUrl = relayUrlInput ? relayUrlInput.value.trim() : '';

    if (!relayUrl) {
      showToast('Please enter a relay server URL', 'error', 3000);
      _isGoingLive = false;
      currentRoomKey = null;
      return;
    }

    try {
      collabRelay = new CollabRelay();

      // Wire relay callbacks
      collabRelay.onRelayConnected = (info) => {
        console.log('[COLLAB] Cloud relay connected:', info);
      };

      collabRelay.onRelayDisconnected = (info) => {
        if (!info.intentional) {
          showToast('Lost connection to relay. Reconnecting...', 'error', 3000);
        }
      };

      collabRelay.onRelayError = (reason) => {
        showToast(`Relay error: ${reason}`, 'error', 3000);
      };

      // Messages from viewers come through the relay
      collabRelay.onMessageReceived = (msg) => {
        handleRelayMessage(msg, true);
      };

      await collabRelay.connectAsHost({
        relayUrl,
        roomKey: currentRoomKey,
        hostName: deviceName,
      });

      collabStatus = 'sharing';
      connectedViewers = [];
      updateShareUI();

      if (onLiveStatusChange) onLiveStatusChange(true);
      showToast(`Live on Cloud Relay -- Room: ${currentRoomKey}`, 'success', 4000);

      // Start state capture (sends state through relay)
      startStateCapture();
      startInteractions(true);
      startChat(true);

      // Override state capture send to use relay
      if (stateCapture) {
        stateCapture.onSendState = (stateMsg) => {
          if (collabRelay) collabRelay.sendMessage(stateMsg);
        };
      }

    } catch (err) {
      showToast(`Relay error: ${err.message}`, 'error', 3000);
      currentRoomKey = null;
      if (collabRelay) {
        collabRelay.destroy();
        collabRelay = null;
      }
    }
    _isGoingLive = false;
  } else {
    // Fallback for non-Electron (web preview)
    collabStatus = 'sharing';
    connectedViewers = [];
    updateShareUI();
    if (onLiveStatusChange) onLiveStatusChange(true);
    showToast(`Live! Room key: ${currentRoomKey} (preview mode)`, 'success', 3000);
  }
}


async function handleStopSharing() {
  // Stop WebSocket server via Electron IPC
  if (electronAPI && electronAPI.collabStopServer) {
    try {
      await electronAPI.collabStopServer();
    } catch (err) {
      console.error('[COLLAB] Error stopping server:', err);
    }
  }

  // Stop cloud relay if active
  if (collabRelay) {
    collabRelay.destroy();
    collabRelay = null;
  }

  // Stop state capture engine
  stopStateCapture();

  // Close teacher dashboard if open
  closeTeacherDashboard();

  // Stop interactions manager
  stopInteractions();

  // Stop collab editor if active
  stopCollabEditor();

  // Stop chat
  stopChat();

  collabStatus = 'disconnected';
  currentRoomKey = null;
  connectedViewers = [];

  // Update UI
  updateShareUI();

  // Remove LIVE indicator
  if (onLiveStatusChange) {
    onLiveStatusChange(false);
  }

  showToast('Stopped sharing', 'info', 2000);
}


/**
 * Update the share panel UI to reflect current state.
 */
function updateShareUI() {
  const goLiveBtn = document.getElementById('collab-go-live');
  const stopBtn = document.getElementById('collab-stop-share');
  const roomKeyContainer = document.getElementById('collab-room-key');
  const roomKeyCode = document.getElementById('collab-room-key-code');
  const viewersSection = document.getElementById('collab-viewers-section');
  const viewersCount = document.getElementById('collab-viewers-count');
  const viewersList = document.getElementById('collab-viewers-list');

  if (collabStatus === 'sharing') {
    // Show sharing state
    if (goLiveBtn) {
      goLiveBtn.classList.add('live');
      goLiveBtn.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          node.textContent = 'Live';
        }
      });
    }

    if (stopBtn) stopBtn.style.display = 'inline-flex';
    if (roomKeyContainer) roomKeyContainer.style.display = 'flex';
    if (roomKeyCode) roomKeyCode.textContent = currentRoomKey || '---';
    const directConnectElement = document.getElementById('collab-direct-connect-code');
    if (directConnectElement) {
      directConnectElement.textContent = currentDirectConnectUrl ? `Direct Connect URL: ${currentDirectConnectUrl}` : '';
    }
    if (viewersSection) viewersSection.style.display = 'flex';

    // Show or create the "View Dashboard" button
    let dashBtn = document.getElementById('collab-dashboard-btn');
    if (!dashBtn) {
      dashBtn = document.createElement('button');
      dashBtn.id = 'collab-dashboard-btn';
      dashBtn.className = 'collab-dashboard-btn';
      dashBtn.textContent = 'View Dashboard';
      dashBtn.addEventListener('click', () => {
        openTeacherDashboard();
      });
      // Insert after the stop button
      stopBtn?.parentNode?.insertBefore(dashBtn, stopBtn.nextSibling);
    }
    dashBtn.style.display = 'inline-flex';

    // Show collab editing toggle
    const collabToggle = document.getElementById('collab-toggle-editing');
    if (collabToggle) collabToggle.style.display = 'flex';

    // Update viewers count
    updateViewersList();
  } else {
    // Show idle state
    if (goLiveBtn) {
      goLiveBtn.classList.remove('live');
      goLiveBtn.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          node.textContent = 'Go Live';
        }
      });
    }

    if (stopBtn) stopBtn.style.display = 'none';
    if (roomKeyContainer) roomKeyContainer.style.display = 'none';
    if (viewersSection) viewersSection.style.display = 'none';

    // Hide dashboard button
    const dashBtn = document.getElementById('collab-dashboard-btn');
    if (dashBtn) dashBtn.style.display = 'none';

    // Hide collab toggle
    const collabToggle = document.getElementById('collab-toggle-editing');
    if (collabToggle) {
      collabToggle.style.display = 'none';
      collabToggle.classList.remove('active');
      const statusEl = collabToggle.querySelector('.collab-toggle-btn__status');
      if (statusEl) statusEl.textContent = 'OFF';
    }
  }
}


/**
 * Update the viewers list in the share panel.
 */
function updateViewersList() {
  const viewersCount = document.getElementById('collab-viewers-count');
  const viewersList = document.getElementById('collab-viewers-list');

  if (viewersCount) {
    const count = connectedViewers.length;
    viewersCount.textContent = `${count} viewer${count !== 1 ? 's' : ''} connected`;
  }

  if (viewersList) {
    viewersList.innerHTML = '';
    connectedViewers.forEach((viewer) => {
      viewersList.appendChild(buildViewerChip(viewer));
    });
  }
}


function handleCopyKey() {
  if (!currentRoomKey) return;

  const textToCopy = currentDirectConnectUrl || currentRoomKey;
  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast(currentDirectConnectUrl ? 'Direct connect URL copied' : 'Room key copied', 'success', 2000);

    // Visual feedback on copy button
    const copyBtn = document.getElementById('collab-copy-key');
    if (copyBtn) {
      const originalText = copyBtn.textContent;
      // Clear and show "Copied!"
      while (copyBtn.lastChild) copyBtn.removeChild(copyBtn.lastChild);
      copyBtn.appendChild(document.createTextNode('Copied!'));
      setTimeout(() => {
        while (copyBtn.lastChild) copyBtn.removeChild(copyBtn.lastChild);
        // Rebuild with icon + text (simplified)
        copyBtn.appendChild(document.createTextNode('Copy'));
      }, 1500);
    }
  }).catch(() => {
    showToast('Failed to copy key', 'error', 2000);
  });
}


// ══════════════════════════════════════════════════════════════════
// VIEWER MODE — Connect / Disconnect
// ══════════════════════════════════════════════════════════════════

async function handleConnect(keyOrDevice) {
  let roomKey = '';
  let host = '';
  let addresses = [];
  let port = 0;

  if (typeof keyOrDevice === 'string') {
    const input = keyOrDevice.trim();

    // Check for Direct Connect URL format: IP:PORT/ROOM_KEY
    if (input.includes('/')) {
      const parts = input.split('/');
      if (parts.length >= 2) {
        roomKey = parts[1].toUpperCase().trim();
        const hostPort = parts[0].split(':');
        if (hostPort.length >= 2) {
          host = hostPort[0];
          port = parseInt(hostPort[1], 10);
          addresses = [host];
          console.log(`[COLLAB] Direct connect parsed: ${host}:${port} for room ${roomKey}`);
        }
      }
    } else {
      roomKey = input.toUpperCase();

      // Look up the key in nearby discovered devices to get host:port
      const matchedDevice = nearbyDevices.find(d => d.roomKey === roomKey);
      if (matchedDevice) {
        host = matchedDevice.host || '';
        addresses = matchedDevice.addresses || [host];
        port = matchedDevice.port || 0;
        console.log(`[COLLAB] Matched device for key ${roomKey}: ${host}:${port} (${addresses.length} IPs)`);
      } else {
        console.log(`[COLLAB] No matching device found for key ${roomKey}. Nearby count: ${nearbyDevices.length}`);
      }
    }
  } else if (keyOrDevice && keyOrDevice.roomKey) {
    // Clicked a device card from nearby devices list
    roomKey = keyOrDevice.roomKey;
    host = keyOrDevice.host || '';
    addresses = keyOrDevice.addresses || [host];
    port = keyOrDevice.port || 0;
    console.log(`[COLLAB] Device card clicked: ${host}:${port} (${roomKey})`);
  }

  if (!roomKey) {
    showToast('Please enter a room key or direct connect URL', 'info', 2000);
    return;
  }

  // Validate key format: T72-XXX
  const KEY_PATTERN = /^T72-[A-Z0-9]{3}$/;
  if (!KEY_PATTERN.test(roomKey)) {
    showToast('Invalid room key format. Expected: T72-XXX or IP:PORT/T72-XXX', 'error', 4000);
    return;
  }

  // If we're in LAN mode, we MUST have a valid host:port from discovery
  if (viewerConnectionMode === 'lan') {
    if (!host || !port) {
      // Fallback 1: Try the nearby list from Electron mDNS
      if (electronAPI && electronAPI.collabNearbyList) {
        try {
          const freshDevices = await electronAPI.collabNearbyList();
          if (freshDevices && freshDevices.length > 0) {
            nearbyDevices = freshDevices;
            const match = freshDevices.find(d => d.roomKey === roomKey);
            if (match) {
              host = match.host || '';
              addresses = match.addresses || [host];
              port = match.port || 0;
              console.log(`[COLLAB] Found on mDNS retry: ${host}:${port}`);
            }
          }
        } catch (_) {}
      }

      // Fallback 2: Try the shared local registry file (works across instances on same machine)
      if ((!host || !port) && electronAPI && electronAPI.collabRegistryLookup) {
        try {
          const result = await electronAPI.collabRegistryLookup(roomKey);
          if (result && result.found) {
            host = result.host || '127.0.0.1';
            addresses = result.addresses || [host];
            port = result.port || 0;
            console.log(`[COLLAB] Found in local registry: ${host}:${port}`);
          }
        } catch (_) {}
      }

      if (!host || !port) {
        // Fallback 3: Try connecting through the public relay server
        // This makes room keys work from ANY network
        console.log(`[COLLAB] LAN discovery failed for ${roomKey}, trying cloud relay...`);
        showToast(`Connecting to ${roomKey} via cloud...`, 'info', 2000);

        try {
          collabRelay = new CollabRelay();

          collabRelay.onRelayConnected = (info) => {
            collabStatus = 'viewing';
            connectedToHost = `${info.hostName} (${info.roomKey})`;
            updateViewerUI();
            showToast(`Connected to ${info.hostName} via Cloud`, 'success', 3000);

            // Show viewer overlay
            if (!stateRenderer) stateRenderer = new StateRenderer();
            stateRenderer.show({
              hostName: info.hostName,
              roomKey: info.roomKey,
              onDisconnect: handleDisconnect,
            });

            closeCollabPanel();
            startInteractions(false);
            startChat(false);
          };

          collabRelay.onRelayDisconnected = (info) => {
            if (!info.intentional) {
              showToast('Lost connection to relay. Reconnecting...', 'error', 3000);
            }
          };

          collabRelay.onRelayError = (reason) => {
            showToast(`Connection failed: ${reason}`, 'error', 3000);
            collabStatus = 'disconnected';
            connectedToHost = null;
            updateViewerUI();
            if (stateRenderer) stateRenderer.hide();
          };

          // Messages from host come through the relay
          collabRelay.onMessageReceived = (msg) => {
            handleRelayMessage(msg, false);
          };

          const connectPasswordInput = document.getElementById('collab-connect-password');
          const connectPassword = connectPasswordInput ? connectPasswordInput.value.trim() : '';

          await collabRelay.connectAsViewer({
            relayUrl: 'wss://theta172-relay.onrender.com',
            roomKey,
            name: getDeviceName(),
            clientId: `viewer-${Date.now()}`,
          });

        } catch (relayErr) {
          showToast(`Room "${roomKey}" not found on any network. Make sure the teacher is live.`, 'error', 4000);
          collabStatus = 'disconnected';
          connectedToHost = null;
          updateViewerUI();
          if (collabRelay) {
            collabRelay.destroy();
            collabRelay = null;
          }
        }
        return; // Already handled via relay
      }
    }
  }

  showToast(`Connecting to room ${roomKey}...`, 'info', 2000);

  // Create WebSocket client and connect
  if (!collabClientInstance) {
    collabClientInstance = new CollabClient();
  }

  // Wire callbacks
  collabClientInstance.onConnected = (info) => {
    collabStatus = 'viewing';
    connectedToHost = `${info.hostName} (${info.roomKey})`;
    updateViewerUI();
    showToast(`Connected to ${info.hostName}`, 'success', 3000);

    // Show the viewer overlay
    if (!stateRenderer) stateRenderer = new StateRenderer();
    stateRenderer.show({
      hostName: info.hostName,
      roomKey: info.roomKey,
      onDisconnect: handleDisconnect,
    });

    // Close the collab panel so the overlay is visible
    closeCollabPanel();

    // Start interactions manager (student mode)
    startInteractions(false);

    // Start chat (student mode)
    startChat(false);
  };

  collabClientInstance.onDisconnected = (info) => {
    if (!info.intentional) {
      showToast(`Disconnected: ${info.reason}`, 'error', 3000);
    }
    collabStatus = 'disconnected';
    connectedToHost = null;
    updateViewerUI();
    // Hide the viewer overlay
    if (stateRenderer) stateRenderer.hide();
  };

  collabClientInstance.onRoomClosed = () => {
    showToast('Host stopped sharing', 'info', 3000);
    collabStatus = 'disconnected';
    connectedToHost = null;
    updateViewerUI();
    // Hide the viewer overlay
    if (stateRenderer) stateRenderer.hide();
  };

  collabClientInstance.onError = (errMsg) => {
    showToast(`Connection error: ${errMsg}`, 'error', 3000);
  };

  collabClientInstance.onStateFullReceived = (state) => {
    console.log('[COLLAB] Received full state:', Object.keys(state));
    if (stateRenderer) stateRenderer.applyFullState(state);
  };

  collabClientInstance.onStateUpdateReceived = (delta) => {
    console.log('[COLLAB] Received state update:', Object.keys(delta));
    if (stateRenderer) stateRenderer.applyDelta(delta);
  };

  collabClientInstance.onPeerJoined = (peer) => {
    showToast(`${peer.name} joined`, 'info', 2000);
  };

  collabClientInstance.onPeerLeft = (peer) => {
    showToast(`${peer.name} left`, 'info', 2000);
  };

  collabClientInstance.onInteractionReceived = (data) => {
    if (interactionsManager) {
      interactionsManager.handleIncoming(data);
    }
  };

  collabClientInstance.onChatReceived = (data) => {
    if (chatManager) {
      chatManager.handleIncoming(data);
    }
  };

  // CRDT collab editing callbacks (student side)
  collabClientInstance.onCrdtReceived = (data) => {
    if (collabEditor) {
      collabEditor.handleCrdtSync(data);
    }
  };

  collabClientInstance.onAwarenessReceived = (data) => {
    if (collabEditor) {
      collabEditor.handleAwareness(data);
    }
  };

  collabClientInstance.onCollabModeChange = (data) => {
    if (data.enabled) {
      startCollabEditor(false);
    } else {
      stopCollabEditor();
    }
    if (collabEditor) {
      collabEditor.handleCollabModeChange(data);
    }
  };

  // If we have host/port from mDNS discovery, connect directly
  // Read optional password from the connect form
  const connectPasswordInput = document.getElementById('collab-connect-password');
  const connectPassword = connectPasswordInput ? connectPasswordInput.value.trim() : '';

  if (viewerConnectionMode === 'cloud') {
    // Cloud relay viewer mode
    const relayUrlInput = document.getElementById('collab-viewer-relay-url');
    const relayUrl = relayUrlInput ? relayUrlInput.value.trim() : '';

    if (!relayUrl) {
      showToast('Please enter a relay server URL', 'error', 3000);
      return;
    }

    try {
      collabRelay = new CollabRelay();

      collabRelay.onRelayConnected = (info) => {
        collabStatus = 'viewing';
        connectedToHost = `${info.hostName} (${info.roomKey})`;
        updateViewerUI();
        showToast(`Connected to ${info.hostName} via Cloud`, 'success', 3000);

        // Show viewer overlay
        if (!stateRenderer) stateRenderer = new StateRenderer();
        stateRenderer.show({
          hostName: info.hostName,
          roomKey: info.roomKey,
          onDisconnect: handleDisconnect,
        });

        closeCollabPanel();
        startInteractions(false);
        startChat(false);
      };

      collabRelay.onRelayDisconnected = (info) => {
        if (!info.intentional) {
          showToast('Lost connection to relay. Reconnecting...', 'error', 3000);
        }
      };

      collabRelay.onRelayError = (reason) => {
        showToast(`Relay error: ${reason}`, 'error', 3000);
        collabStatus = 'disconnected';
        connectedToHost = null;
        updateViewerUI();
        if (stateRenderer) stateRenderer.hide();
      };

      // Messages from host come through the relay
      collabRelay.onMessageReceived = (msg) => {
        handleRelayMessage(msg, false);
      };

      await collabRelay.connectAsViewer({
        relayUrl,
        roomKey,
        name: getDeviceName(),
        clientId: `viewer-${Date.now()}`,
      });

    } catch (err) {
      showToast(`Failed to connect: ${err.message}`, 'error', 3000);
      collabStatus = 'disconnected';
      connectedToHost = null;
      updateViewerUI();
      if (collabRelay) {
        collabRelay.destroy();
        collabRelay = null;
      }
    }
  } else {
    // LAN mode — direct WebSocket connect
    try {
      console.log(`[COLLAB] Connecting to ${host}:${port} (Addresses: ${addresses.join(', ')}) for room ${roomKey}`);
      await collabClientInstance.connect({
        host: host,
        addresses: addresses,
        port: port,
        roomKey: roomKey,
        name: getDeviceName(),
        password: connectPassword || undefined,
      });
    } catch (err) {
      showToast(`Failed to connect: ${err.message}`, 'error', 3000);
      collabStatus = 'disconnected';
      connectedToHost = null;
      updateViewerUI();
    }
  }
}


function handleDisconnect() {
  // Disconnect WebSocket client
  if (collabClientInstance) {
    collabClientInstance.destroy();
    collabClientInstance = null;
  }

  // Disconnect cloud relay
  if (collabRelay) {
    collabRelay.destroy();
    collabRelay = null;
  }

  // Hide viewer overlay
  if (stateRenderer) {
    stateRenderer.hide();
    stateRenderer = null;
  }

  // Stop interactions manager
  stopInteractions();

  // Stop collab editor
  stopCollabEditor();

  // Stop chat
  stopChat();

  collabStatus = 'disconnected';
  connectedToHost = null;

  // Update UI
  updateViewerUI();

  showToast('Disconnected from room', 'info', 2000);
}


/**
 * Update the viewer panel UI to reflect current state.
 */
function updateViewerUI() {
  const viewerPanel = document.getElementById('collab-viewer-panel');
  const connectForm = viewerPanel?.querySelector('.collab-connect-form');
  const nearbySection = document.getElementById('collab-nearby');
  const connectedStatus = document.getElementById('collab-connected-status');
  const connectedHost = document.getElementById('collab-connected-host');

  if (collabStatus === 'viewing') {
    // Show connected state
    if (connectForm) connectForm.style.display = 'none';
    if (nearbySection) nearbySection.style.display = 'none';
    if (connectedStatus) {
      connectedStatus.classList.add('visible');
    }
    if (connectedHost) {
      connectedHost.textContent = `Viewing: Room ${connectedToHost}`;
    }
  } else {
    // Show disconnected state
    if (connectForm) connectForm.style.display = 'flex';
    if (nearbySection) nearbySection.style.display = 'block';
    if (connectedStatus) {
      connectedStatus.classList.remove('visible');
    }
  }
}

// ════════════════════════════════════════════════════════════════
// TEACHER DASHBOARD
// ════════════════════════════════════════════════════════════════

/**
 * Open the teacher dashboard overlay.
 * Shows a grid of all connected students' code.
 */
function openTeacherDashboard() {
  if (teacherDashboard) teacherDashboard.hide();

  teacherDashboard = new TeacherDashboard();
  teacherDashboard.show({
    roomKey: currentRoomKey || '---',
    onClose: () => {
      teacherDashboard = null;
    },
  });

  // Populate with current viewers
  connectedViewers.forEach((viewer) => {
    teacherDashboard.updateStudentState(viewer.id, viewer.name, {});
  });

  // Close the collab panel so the dashboard is visible
  closeCollabPanel();
}

/**
 * Close the teacher dashboard.
 */
function closeTeacherDashboard() {
  if (teacherDashboard) {
    teacherDashboard.hide();
    teacherDashboard = null;
  }
}

/**
 * Get the active teacher dashboard (for forwarding viewer state).
 * @returns {TeacherDashboard | null}
 */
export function getTeacherDashboard() {
  return teacherDashboard;
}


// ════════════════════════════════════════════════════════════════
// STATE CAPTURE HELPERS (Sharer side)
// ════════════════════════════════════════════════════════════════

/**
 * Start the state capture engine.
 * Called when the sharer clicks Go Live.
 * Requires editorGetters to be set via initCollabPanel.
 */
function startStateCapture() {
  if (stateCapture) {
    stateCapture.stop();
    stateCapture = null;
  }

  if (!editorGetters) {
    console.warn('[COLLAB] Cannot start state capture — no editor getters');
    return;
  }

  stateCapture = new StateCapture({
    getCode: editorGetters.getCode,
    getCursor: editorGetters.getCursor,
    getSelection: editorGetters.getSelection || (() => null),
    getFileName: editorGetters.getFileName || (() => 'main.py'),
    getTabs: editorGetters.getTabs || (() => []),
    getErrors: editorGetters.getErrors || (() => []),
    getIsRunning: editorGetters.getIsRunning || (() => false),
    getFontSize: editorGetters.getFontSize || (() => 14),
    getTheme: editorGetters.getTheme || (() => 'dark'),

    onDelta: (delta) => {
      // Send delta to viewers via Electron IPC
      if (electronAPI && electronAPI.collabStateDelta) {
        electronAPI.collabStateDelta(delta);
      }
    },

    onFullState: (state) => {
      // Send full state snapshot to server via IPC
      if (electronAPI && electronAPI.collabStateFull) {
        electronAPI.collabStateFull(state);
      }
    },
  });

  stateCapture.start();
}

/**
 * Stop the state capture engine.
 * Called when the sharer clicks Stop Sharing.
 */
function stopStateCapture() {
  if (stateCapture) {
    stateCapture.stop();
    stateCapture = null;
  }
}

/**
 * Get the state capture instance (for main.js to hook editor events).
 * @returns {StateCapture | null}
 */
export function getStateCapture() {
  return stateCapture;
}


// ════════════════════════════════════════════════════════════════
// INTERACTION HELPERS
// ════════════════════════════════════════════════════════════════

/**
 * Start the interactions manager.
 * @param {boolean} isTeacher - true if sharer (teacher), false if viewer (student)
 */
function startInteractions(isTeacher) {
  if (interactionsManager) {
    interactionsManager.destroy();
    interactionsManager = null;
  }

  interactionsManager = new InteractionsManager();

  interactionsManager.init({
    isTeacher: isTeacher,
    container: document.body,
    onSend: (interaction) => {
      if (isTeacher) {
        // Teacher sends via Electron IPC (server broadcasts to students)
        if (electronAPI && electronAPI.collabSendInteraction) {
          electronAPI.collabSendInteraction(interaction);
        }
      } else {
        // Student sends via WebSocket client (server forwards to teacher)
        if (collabClientInstance) {
          collabClientInstance.sendInteraction(interaction);
        }
      }
    },
  });
}

/**
 * Stop the interactions manager.
 */
function stopInteractions() {
  if (interactionsManager) {
    interactionsManager.destroy();
    interactionsManager = null;
  }
}

/**
 * Get the active interactions manager.
 * @returns {InteractionsManager | null}
 */
export function getInteractions() {
  return interactionsManager;
}


// ════════════════════════════════════════════════════════════════
// CHAT HELPERS
// ════════════════════════════════════════════════════════════════

/**
 * Start the chat manager.
 * @param {boolean} isTeacher - true if sharer (teacher)
 */
function startChat(isTeacher) {
  if (chatManager) {
    chatManager.destroy();
    chatManager = null;
  }

  chatManager = new ChatManager();

  chatManager.init({
    userName: getDeviceName(),
    isTeacher: isTeacher,
    onSend: (chatMsg) => {
      if (isTeacher) {
        // Teacher sends via Electron IPC (server broadcasts to students)
        if (electronAPI && electronAPI.collabSendChat) {
          electronAPI.collabSendChat(chatMsg);
        }
      } else {
        // Student sends via WebSocket client (server forwards to all)
        if (collabClientInstance) {
          collabClientInstance.sendChat(chatMsg);
        }
      }
    },
    onTyping: (typingMsg) => {
      if (isTeacher) {
        if (electronAPI && electronAPI.collabSendChat) {
          electronAPI.collabSendChat(typingMsg);
        }
      } else {
        if (collabClientInstance) {
          collabClientInstance.sendChat(typingMsg);
        }
      }
    },
  });
}

/**
 * Stop the chat manager.
 */
function stopChat() {
  if (chatManager) {
    chatManager.destroy();
    chatManager = null;
  }
}

/**
 * Get the active chat manager.
 * @returns {ChatManager | null}
 */
export function getChat() {
  return chatManager;
}


// ════════════════════════════════════════════════════════════════
// COLLAB EDITOR HELPERS
// ════════════════════════════════════════════════════════════════

/**
 * Start the collab editor.
 * @param {boolean} isTeacher
 */
function startCollabEditor(isTeacher) {
  if (collabEditor) {
    collabEditor.destroy();
    collabEditor = null;
  }

  collabEditor = new CollabEditor();

  if (isTeacher) {
    collabEditor.initTeacher({
      userName: getDeviceName(),
      onSendCrdt: (data) => {
        if (electronAPI && electronAPI.collabSendCrdt) {
          electronAPI.collabSendCrdt(data);
        }
      },
      onSendAwareness: (data) => {
        if (electronAPI && electronAPI.collabSendAwareness) {
          electronAPI.collabSendAwareness(data);
        }
      },
      onSendCollabMode: (data) => {
        if (electronAPI && electronAPI.collabSendCollabMode) {
          electronAPI.collabSendCollabMode(data);
        }
      },
      onGetCode: () => getEditorCode(),
      onSetCode: (code) => setEditorCode(code),
      onGetEditorView: () => getEditorView(),
      onPauseCapture: () => {
        if (stateCapture) stateCapture.stop();
      },
      onResumeCapture: () => {
        if (stateCapture) stateCapture.start();
      },
    });
  } else {
    collabEditor.initStudent({
      userName: getDeviceName(),
      clientId: collabClientInstance ? collabClientInstance.clientId : Math.floor(Math.random() * 1000),
      onSendCrdt: (data) => {
        if (collabClientInstance) collabClientInstance.sendCrdt(data);
      },
      onSendAwareness: (data) => {
        if (collabClientInstance) collabClientInstance.sendAwareness(data);
      },
      onHideRenderer: () => {
        if (stateRenderer) stateRenderer.hide();
      },
      onShowRenderer: () => {
        if (stateRenderer && connectedToHost) {
          stateRenderer.show({
            hostName: connectedToHost,
            roomKey: currentRoomKey || '---',
            onDisconnect: handleDisconnect,
          });
        }
      },
      onDisconnect: handleDisconnect,
    });
  }
}

/**
 * Stop the collab editor.
 */
function stopCollabEditor() {
  if (collabEditor) {
    collabEditor.destroy();
    collabEditor = null;
  }
}

/**
 * Toggle collab editing mode (teacher only).
 * Called from the share panel toggle button.
 */
export function toggleCollabMode() {
  if (collabStatus !== 'sharing') return;

  if (!collabEditor) {
    startCollabEditor(true);
  }

  collabEditor.toggleCollabMode();

  // Update toggle button state
  const toggleBtn = document.getElementById('collab-toggle-editing');
  if (toggleBtn) {
    const isActive = collabEditor.isActive();
    toggleBtn.classList.toggle('active', isActive);
    const statusEl = toggleBtn.querySelector('.collab-toggle-btn__status');
    if (statusEl) {
      statusEl.textContent = isActive ? 'ON' : 'OFF';
    }
  }
}

/**
 * Get the active collab editor.
 * @returns {CollabEditor | null}
 */
export function getCollabEditor() {
  return collabEditor;
}


// ════════════════════════════════════════════════════════════════
// CLOUD RELAY MESSAGE HANDLER
// ════════════════════════════════════════════════════════════════

/**
 * Handle a message received through the cloud relay.
 * Dispatches to existing handlers based on message type.
 * @param {Object} msg - The forwarded protocol message
 * @param {boolean} isHost - Whether we are the host (teacher)
 */
function handleRelayMessage(msg, isHost) {
  if (!msg || !msg.type) return;

  const type = msg.type;
  const payload = msg.payload || {};

  if (isHost) {
    // Teacher receiving messages from viewers through relay
    switch (type) {
      case 'join':
        // Viewer joined — track them
        if (payload.name) {
          connectedViewers.push({ id: payload.clientId || '', name: payload.name });
          updateViewersList();
          showToast(`${payload.name} joined`, 'info', 2000);

          // Send current state to the new viewer
          if (stateCapture && collabRelay) {
            try {
              const fullState = stateCapture.captureFullState();
              collabRelay.sendMessage({
                type: 'state_full',
                payload: fullState,
              });
            } catch (_) {}
          }
        }
        break;

      case 'leave':
        // Viewer left
        if (payload.clientId) {
          connectedViewers = connectedViewers.filter(v => v.id !== payload.clientId);
          updateViewersList();
          showToast(`${payload.name || 'Viewer'} left`, 'info', 2000);
        }
        break;

      case 'student_state':
        // Student state for dashboard
        if (teacherDashboard) {
          teacherDashboard.updateStudentState(payload.clientId || msg.senderId, payload);
        }
        break;

      case 'interaction':
        if (interactionsManager) {
          interactionsManager.handleIncoming(payload);
        }
        break;

      case 'chat':
        if (chatManager) {
          chatManager.handleIncoming({
            type: payload.type || 'chat_text',
            text: payload.text || '',
            senderName: payload.senderName || 'Student',
            senderId: payload.senderId || '',
            isTeacher: false,
            timestamp: payload.timestamp || Date.now(),
          });
        }
        break;

      case 'crdt_sync':
        if (collabEditor) collabEditor.handleCrdtSync(payload);
        break;

      case 'crdt_awareness':
        if (collabEditor) collabEditor.handleAwareness(payload);
        break;

      default:
        break;
    }
  } else {
    // Student receiving messages from host through relay
    switch (type) {
      case 'state_full':
        if (stateRenderer) stateRenderer.applyFullState(payload);
        break;

      case 'state_update':
        if (stateRenderer) stateRenderer.applyDelta(payload);
        break;

      case 'interaction':
        if (interactionsManager) interactionsManager.handleIncoming(payload);
        break;

      case 'chat':
        if (chatManager) chatManager.handleIncoming(payload);
        break;

      case 'crdt_sync':
        if (collabEditor) collabEditor.handleCrdtSync(payload);
        break;

      case 'crdt_awareness':
        if (collabEditor) collabEditor.handleAwareness(payload);
        break;

      case 'collab_mode':
        if (payload.enabled) {
          startCollabEditor(false);
        } else {
          stopCollabEditor();
        }
        if (collabEditor) collabEditor.handleCollabModeChange(payload);
        break;

      case 'room_closed':
        showToast('Host stopped sharing', 'info', 3000);
        handleDisconnect();
        break;

      default:
        break;
    }
  }
}

/**
 * Get the active relay instance.
 * @returns {CollabRelay | null}
 */
export function getCollabRelay() {
  return collabRelay;
}

// ════════════════════════════════════════════════════════════════
// mDNS DISCOVERY HELPERS
// ════════════════════════════════════════════════════════════════

let webDiscoveryChannel = null;

function initWebDiscovery() {
  if (webDiscoveryChannel) return;
  try {
    webDiscoveryChannel = new BroadcastChannel('theta172_discovery');
    
    webDiscoveryChannel.onmessage = (event) => {
      if (collabStatus === 'sharing' && event.data.type === 'DISCOVERY_REQUEST') {
        // We are sharing, respond to the ping
        webDiscoveryChannel.postMessage({
          type: 'DISCOVERY_RESPONSE',
          roomKey: currentRoomKey,
          hostName: getDeviceName(),
          directConnectUrl: currentDirectConnectUrl
        });
      } else if (collabRole === 'viewer' && event.data.type === 'DISCOVERY_RESPONSE') {
        // Parse the direct connect URL to extract host and port
        let host = 'localhost';
        let port = 0;
        if (event.data.directConnectUrl) {
           const parts = event.data.directConnectUrl.split('/');
           const hostPort = parts[0].split(':');
           if (hostPort.length >= 2) {
              host = hostPort[0];
              port = parseInt(hostPort[1], 10);
           }
        }

        // We are browsing, process the discovered host
        const device = {
          name: event.data.hostName,
          roomKey: event.data.roomKey,
          host: host,
          port: port,
          addresses: [host]
        };
        // Check if already in list
        const exists = nearbyDevices.find(d => d.roomKey === device.roomKey);
        if (!exists) {
          updateNearbyDevices([...nearbyDevices, device]);
        }
      }
    };
  } catch (err) {
    console.warn('[COLLAB] BroadcastChannel not supported in this browser.');
  }
}

/**
 * Start mDNS browsing for nearby THETA172 sharers.
 * Called when user selects Viewer role.
 */
function startDiscoveryBrowse() {
  const scanIndicator = document.getElementById('collab-scanning-indicator');
  if (scanIndicator) scanIndicator.style.display = 'inline-block';

  // Always initialize Web Fallback (for Electron <-> Chrome localhost testing)
  initWebDiscovery();
  if (webDiscoveryChannel) {
    webDiscoveryChannel.postMessage({ type: 'DISCOVERY_REQUEST' });
  }

  if (!electronAPI || !electronAPI.collabBrowseStart) {
    return;
  }

  electronAPI.collabBrowseStart().catch((err) => {
    console.error('[COLLAB] Failed to start discovery:', err);
  });
}

/**
 * Stop mDNS browsing.
 * Called when switching to Share mode or closing the panel.
 */
function stopDiscoveryBrowse() {
  const scanIndicator = document.getElementById('collab-scanning-indicator');
  if (scanIndicator) scanIndicator.style.display = 'none';

  if (!electronAPI || !electronAPI.collabBrowseStop) {
    // Web Fallback
    updateNearbyDevices([]);
    return;
  }

  electronAPI.collabBrowseStop().catch((err) => {
    console.error('[COLLAB] Failed to stop discovery:', err);
  });
}


// ════════════════════════════════════════════════════════════════
// NEARBY DEVICES
// ════════════════════════════════════════════════════════════════

/**
 * Update the nearby devices list.
 * Called when mDNS discovers or loses a nearby THETA172 service.
 */
export function updateNearbyDevices(devices) {
  nearbyDevices = devices;

  const list = document.getElementById('collab-nearby-list');
  const emptyMsg = document.getElementById('collab-nearby-empty');

  if (!list) return;

  // Clear existing cards (but keep empty message)
  const existingCards = list.querySelectorAll('.collab-device-card');
  existingCards.forEach((card) => card.remove());

  if (devices.length === 0) {
    if (emptyMsg) emptyMsg.style.display = 'block';
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';

  devices.forEach((device) => {
    const card = buildDeviceCard(device, (dev) => {
      handleConnect(dev);
    });
    list.appendChild(card);
  });
}


// ══════════════════════════════════════════════════════════════════
// DASHBOARD (Phase 5 skeleton)
// ══════════════════════════════════════════════════════════════════

/**
 * Update the dashboard grid with student tiles.
 * Called by the state sync engine in Phase 5.
 */
export function updateDashboard(students) {
  const dashboard = document.getElementById('collab-dashboard');
  const grid = document.getElementById('collab-dashboard-grid');

  if (!dashboard || !grid) return;

  grid.innerHTML = '';

  students.forEach((student) => {
    const tile = buildDashboardTile(student, (s) => {
      showToast(`Viewing ${s.name}...`, 'info', 1500);
      // TODO (Phase 5): Expand to full IDE view
    });
    grid.appendChild(tile);
  });
}


// ══════════════════════════════════════════════════════════════════
// PUBLIC API — For integration with main.js
// ══════════════════════════════════════════════════════════════════

/**
 * Initialize the collab panel.
 * Called from main.js during IDE setup.
 *
 * @param {Object} options
 * @param {Function} options.onLiveChange    - Callback when live status changes (boolean)
 * @param {Object}   options.editorGetters   - Functions to read IDE state for state capture
 */
export function initCollabPanel(options = {}) {
  if (options.onLiveChange) {
    onLiveStatusChange = options.onLiveChange;
  }

  // Store editor state getters for StateCapture
  if (options.editorGetters) {
    editorGetters = options.editorGetters;
  }

  // Cache the Electron API reference
  electronAPI = window.api || null;

  // Listen for viewer changes from the server (via IPC)
  if (electronAPI) {
    if (electronAPI.onCollabViewersChanged) {
      electronAPI.onCollabViewersChanged((viewers) => {
        connectedViewers = viewers;
        updateViewersList();
      });
    }

    if (electronAPI.onCollabServerError) {
      electronAPI.onCollabServerError((errMsg) => {
        showToast(`Server error: ${errMsg}`, 'error', 3000);
      });
    }

    if (electronAPI.onCollabHighlightRequest) {
      electronAPI.onCollabHighlightRequest((highlight) => {
        // Forward to interactions manager (teacher side)
        if (interactionsManager) {
          interactionsManager.handleIncoming({
            type: 'interaction_highlight',
            payload: highlight,
            senderName: highlight.viewerName || 'Student',
            senderId: highlight.viewerId || '',
          });
        }
      });
    }

    // Listen for nearby device updates from mDNS discovery
    if (electronAPI.onCollabNearbyDevices) {
      electronAPI.onCollabNearbyDevices((devices) => {
        updateNearbyDevices(devices);
      });
    }

    // Listen for student state updates (for teacher dashboard)
    if (electronAPI.onCollabStudentState) {
      electronAPI.onCollabStudentState((data) => {
        if (teacherDashboard) {
          teacherDashboard.updateStudentState(
            data.viewerId,
            data.viewerName,
            data.state
          );
        }
      });
    }

    // Listen for interactions from viewers (teacher side)
    if (electronAPI.onCollabInteraction) {
      electronAPI.onCollabInteraction((data) => {
        if (interactionsManager) {
          interactionsManager.handleIncoming({
            type: data.payload?.type || data.interactionType,
            payload: data.payload || {},
            senderName: data.viewerName || 'Student',
            senderId: data.viewerId || '',
          });
        }
      });
    }

    // Listen for chat messages from viewers (teacher side)
    if (electronAPI.onCollabChat) {
      electronAPI.onCollabChat((data) => {
        if (chatManager) {
          chatManager.handleIncoming({
            type: data.payload?.type || 'chat_text',
            text: data.payload?.text || '',
            senderName: data.viewerName || 'Student',
            senderId: data.viewerId || '',
            isTeacher: false,
            timestamp: data.payload?.timestamp || Date.now(),
          });
        }
      });
    }

    // Listen for CRDT sync messages from viewers (teacher side)
    if (electronAPI.onCollabCrdt) {
      electronAPI.onCollabCrdt((data) => {
        if (collabEditor) {
          collabEditor.handleCrdtSync(data.payload || data);
        }
      });
    }

    // Listen for CRDT awareness from viewers (teacher side)
    if (electronAPI.onCollabAwareness) {
      electronAPI.onCollabAwareness((data) => {
        if (collabEditor) {
          collabEditor.handleAwareness(data.payload || data);
        }
      });
    }
  }

  // Panel will be built lazily on first open
  // (avoids DOM overhead on startup)
}


/**
 * Get current collab state — useful for status bar or other UI.
 */
export function getCollabState() {
  return {
    role: collabRole,
    status: collabStatus,
    roomKey: currentRoomKey,
    viewerCount: connectedViewers.length,
    connectedTo: connectedToHost,
    deviceName: getDeviceName(),
    panelOpen,
  };
}


/**
 * Set the device name (user-customizable).
 */
export function setDeviceName(name) {
  if (name && name.trim()) {
    localStorage.setItem('theta-collab-device-name', name.trim());
  }
}


/**
 * Check if currently sharing (for LIVE indicator on logo).
 */
export function isSharing() {
  return collabStatus === 'sharing';
}


/**
 * Check if currently viewing someone else's IDE.
 */
export function isViewing() {
  return collabStatus === 'viewing';
}


// ══════════════════════════════════════════════════════════════════
// KEYBOARD HANDLING
// ══════════════════════════════════════════════════════════════════

/**
 * Handle Escape key to close the panel.
 * This is called from the main keyboard handler in main.js.
 */
export function handleCollabKeydown(e) {
  if (!panelOpen) return false;

  if (e.key === 'Escape') {
    closeCollabPanel();
    return true; // consumed
  }

  return false;
}
