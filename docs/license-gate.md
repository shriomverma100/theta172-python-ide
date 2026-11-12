# The owner's gate — turning the software on or off, everywhere

Every installed copy of Python by THETA172 quietly checks a small document
that only **you** can sign. With it you can turn the software off — on one
computer, or everywhere at once — and it shows a branded lock screen instead
of opening. This is for the future, when THETA172 licenses the software to
schools and companies.

**Right now it is set to ON and does nothing.** The software runs exactly as
before. Nothing below happens until you choose to turn it off.

End users are never told this exists. It is not in the release notes.

## Your key — keep it safe

A signing key was created on your computer at:

```
C:\Users\<you>\.theta172\license-private.pem
```

- **Only this key can turn the software on or off.** The app carries the
  matching public key, so no one else can forge a command.
- **Back it up** somewhere safe (a password manager, an encrypted drive).
  If you lose it, you can no longer control installed copies without
  shipping a new version with a new key.
- **Never put it in the repository or share it.** It stays on your machine.

## Turn the software off (everywhere)

```sh
npm run license -- disable --message "Your message to the user" --push
```

`--push` commits and pushes `license.json` for you. Within a few minutes (or
the next time a copy opens), every installed copy shows the lock screen with
your message. Optionally add `--contact "you@example.com"`.

## Turn it back on

```sh
npm run license -- enable --push
```

## Turn off one computer

A locked computer's screen shows a short **Device** code. To turn off just
that machine:

```sh
npm run license -- block A1B2C3D4 --push
```

Undo with `npm run license -- unblock A1B2C3D4 --push`.

## Strict mode (for enterprise)

By default the software is **lenient**: if a copy cannot reach the document
(no internet), it keeps running. For a paid deployment where nothing should
run without permission, switch to **strict** — then a copy runs only while it
can confirm a fresh "on", and locks otherwise:

```sh
npm run license -- strict --push        # fail-closed
npm run license -- lenient --push        # back to the default
```

`npm run license -- status` shows the current setting.

## How it works

- The app checks `license.json` in the repo (via GitHub raw, with a jsDelivr
  mirror) at start-up and every 2 hours.
- The document is signed with your private key (Ed25519). The app verifies it
  with the built-in public key, so a tampered or forged document is ignored.
- A seen "off" is cached, so a computer stays locked even if it goes offline,
  and an older document can never undo a newer one (anti-rollback).
- It only runs in the installed app. Development and the test runner always
  allow, so your own work is never affected.

Files: `electron/gate.cjs` (the check), `electron/lock.html` (the screen),
`scripts/license.cjs` (this tool), `tests/gate.test.js`.
