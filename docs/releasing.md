# Releasing a new version

Every installed copy of Python by THETA172 updates itself from the GitHub
Releases of this repository. Publishing a release is how a change reaches
everyone.

## The routine

1. Make the change on a branch, test it, and merge it into **main**.
2. Write what changed in [`RELEASE_NOTES.md`](../RELEASE_NOTES.md), one line per change starting with `- `.
   Students and teachers see these lines in the "New update available" card.
3. On main, run one of:

   ```sh
   npm run release -- patch      # fixes:        1.1.0 → 1.1.1
   npm run release -- minor      # new features: 1.1.0 → 1.2.0
   npm run release -- major      # big change:   1.1.0 → 2.0.0
   ```

   Add `--critical` for an important fix: the card then has no **Later** button.
   Add `--dry` to see what would happen without changing anything.

The script checks that you are on main with nothing uncommitted, runs lint and
the tests, sets the version, saves the notes in `release-notes/`, commits, tags
`vX.Y.Z` and pushes. GitHub Actions ([build.yml](../.github/workflows/build.yml))
then builds the installer (about 15 minutes) and publishes the release. The
build refuses a tag that is not on main.

## What users see

- Within 4 hours (or at once with **Help → Check for updates…**) the app downloads
  the new version in the background. Only the parts that changed are downloaded.
- When it is ready, and not during a live class, a running program or a debug
  session, a card asks: **Update now** or **Later**. "Later" asks again after 4 hours,
  and the update also installs by itself the next time the app is closed.
- **Update now** saves open files and shows the updating screen (a pixel snake, the
  progress, and Python tips in English or हिंदी). The app closes, installs in about
  10 seconds and opens again, then shows **What's new**.

## Download link for new installs

This link always gives the newest installer:

```
https://github.com/shriomverma100/theta172-python-ide/releases/latest/download/Python-by-THETA172-Setup.exe
```

The installer is not code-signed yet, so Windows shows "Windows protected your
PC" the first time: **More info → Run anyway**. Updates are not affected.

## Schools: controlling updates

An IT person can create `C:\ProgramData\THETA172\policy.json`:

```json
{ "updates": "manual" }
```

| Value | Meaning |
|---|---|
| `"auto"` | Download by itself and ask (the default) |
| `"manual"` | Only when someone chooses Help → Check for updates |
| `"off"` | Never; the IT team installs new versions |

Users can also turn off **Settings → Automatic updates** on their own computer.

## Trying an update on your PC without publishing

```sh
npx electron-builder --win nsis --x64 --publish never -c.extraMetadata.version=9.9.9 -c.directories.output=tmp/update-test
node scripts/update-server.cjs --dir tmp/update-test --kbps 12000
THETA_UPDATE_URL=http://127.0.0.1:8123/ npm run electron:preview
```

The app finds 9.9.9, downloads and verifies it, and shows the card and the
updating screen. In this test mode it never installs by itself; pressing
**Update now** would really install 9.9.9 on this PC.
