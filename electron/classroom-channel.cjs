/**
 * THETA172 — Classroom delivery that survives network changes.
 *
 * A classroom link (local Wi-Fi socket or the internet relay) can drop at
 * any moment: a student walks between access points, a laptop sleeps, a
 * teacher switches from school Wi-Fi to a phone hotspot. The ReliableChannel
 * sits above whichever link is up and makes sure nothing the other side
 * needs is lost:
 *
 *   - every message gets a sequence number and stays buffered until the
 *     other side acknowledges it;
 *   - after a reconnect (on the same link or another one) each side says
 *     what it last received, and the other side resends the rest in order;
 *   - duplicates (a message that arrived just before the drop) are ignored;
 *   - "latest wins" messages (live code, cursor) carry a key, so a long
 *     outage resends only the newest copy instead of every keystroke.
 *
 * Frames on the wire: { s, m } a message · { a } an acknowledgement ·
 * { r, e } "I have everything up to r of your epoch e" (sent on connect).
 * The epoch changes when a side restarts, so old numbers are not reused.
 */

'use strict';

const crypto = require('crypto');

const MAX_BUFFERED = 2000;      // messages kept for resending
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const ACK_DELAY_MS = 150;

class ReliableChannel {
  /**
   * @param {object} opts
   * @param {(frame: object) => boolean} opts.transmit  send a frame on the current link; false when no link is up
   * @param {(msg: object) => void} opts.deliver        a new message from the other side, in order
   * @param {() => void} [opts.onOverflow]              messages had to be dropped (the other side should resync)
   */
  constructor({ transmit, deliver, onOverflow }) {
    this.transmit = transmit;
    this.deliver = deliver;
    this.onOverflow = onOverflow;
    this.epoch = crypto.randomBytes(6).toString('hex');
    this.nextSeq = 1;
    this.buffer = []; // { s, m, key, bytes }
    this.bufferedBytes = 0;
    this.peerEpoch = null;
    this.lastRecv = 0; // highest sequence delivered from the peer
    this.ackTimer = null;
    this.up = false;
  }

  /** Queue a message; it is sent now if a link is up, otherwise after the next reconnect. */
  send(msg, { key } = {}) {
    if (key) {
      // Latest wins: an older copy that is still waiting is no longer needed
      const i = this.buffer.findIndex((b) => b.key === key);
      if (i >= 0) {
        this.bufferedBytes -= this.buffer[i].bytes;
        this.buffer.splice(i, 1);
      }
    }
    const s = this.nextSeq++;
    const bytes = estimateBytes(msg);
    this.buffer.push({ s, m: msg, key, bytes });
    this.bufferedBytes += bytes;
    this._trim();
    if (this.up) this.transmit({ s, m: msg });
  }

  /** The link is up: tell the other side what we have; it resends the rest. */
  linkUp() {
    this.up = true;
    this.transmit({ r: this.lastRecv, e: this.peerEpoch, me: this.epoch });
  }

  linkDown() {
    this.up = false;
    clearTimeout(this.ackTimer);
    this.ackTimer = null;
  }

  /** A frame arrived on the current link. */
  receive(frame) {
    if (!frame || typeof frame !== 'object') return;
    if (typeof frame.me === 'string' && frame.me !== this.peerEpoch) {
      // The other side restarted (or this is the first contact): its numbering starts over
      this.peerEpoch = frame.me;
      this.lastRecv = 0;
    }
    if (Number.isInteger(frame.r)) {
      // Resend whatever the other side has not got. If it lost our epoch, it has nothing of ours.
      const have = frame.e === this.epoch ? frame.r : 0;
      this._ackUpTo(have);
      for (const b of this.buffer) this.transmit({ s: b.s, m: b.m });
      return;
    }
    if (Number.isInteger(frame.a)) {
      this._ackUpTo(frame.a);
      return;
    }
    if (Number.isInteger(frame.s)) {
      if (frame.s > this.lastRecv) {
        this.lastRecv = frame.s;
        try { this.deliver(frame.m); } catch (_) { /* a bad message must not stop the channel */ }
      }
      this._scheduleAck();
    }
  }

  /** Messages waiting for the other side (for tests and the status line). */
  get pending() { return this.buffer.length; }

  _ackUpTo(n) {
    while (this.buffer.length && this.buffer[0].s <= n) this.bufferedBytes -= this.buffer.shift().bytes;
  }

  _scheduleAck() {
    if (this.ackTimer || !this.up) return;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      if (this.up) this.transmit({ a: this.lastRecv });
    }, ACK_DELAY_MS);
  }

  _trim() {
    let dropped = false;
    while (this.buffer.length > MAX_BUFFERED || (this.bufferedBytes > MAX_BUFFERED_BYTES && this.buffer.length > 1)) {
      this.bufferedBytes -= this.buffer.shift().bytes;
      dropped = true;
    }
    if (dropped) this.onOverflow?.();
  }

  dispose() {
    this.linkDown();
    this.buffer = [];
    this.bufferedBytes = 0;
  }
}

function estimateBytes(msg) {
  try { return JSON.stringify(msg).length; } catch (_) { return 1024; }
}

/**
 * Delay before reconnect attempt n (0, 1, 2 …): quick at first, then up to
 * `max`, with jitter so a whole class does not reconnect in the same instant.
 */
function backoff(n, { min = 400, max = 6000 } = {}) {
  const base = Math.min(max, min * 2 ** Math.min(n, 8));
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

module.exports = { ReliableChannel, backoff, MAX_BUFFERED };
