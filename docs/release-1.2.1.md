# ClassGrab 1.2.1 release handoff

Material detail pages could show an empty file list even with supported
attachments visible. The reported layout has one `.EE538` shell containing
nine file cards beside two nested current-post controls that contain no files.
The scanner previously recognized that shell only on announcement routes.

Version 1.2.1 recognizes it on material routes too. It requires a visible
marker matching the current post, rejects foreign courses/posts and ambiguous
shells, and preserves ownership checks while Classroom renders another post.
The Stream buttons, duplicate decisions, download flow, permissions and
minimum Chromium version remain as in 1.2.0.

## Local verification

The regression for the reported nine-file layout and its navigation case
failed on the previous scanner, then passed with the fix. All 35 content-scope
tests passed, including negative boundaries, hidden cached shells, outside
links, stale files, announcement details and the Stream selection tests.
Every committed fixture uses synthetic identifiers and filenames.

The optional installed-extension smoke test passed all 9 Node checks (one
parent and eight subtests) on Chromium 151.0.7922.34. The new material case
uses real DOM layout and content-script injection, detects exactly nine files,
ignores hidden/outside attachments, rejects retained files after a post change,
and accepts newly rendered links. Existing Stream popup, scoped batch,
duplicate Cancel and cleanup checks also pass. Browser download
acceptance/history and Google response bytes are stubbed. The isolated
profile has no Google account and external requests are blocked/intercepted.
This is not a signed-in Chrome/Edge or real Google download test.

Run the documented release gate from the repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release.ps1
```

Verified locally on 3 October 2026:

- The complete release command passed: syntax, download concurrency,
  background storage/duplicate reconciliation, 35 content-scope cases,
  19 popup-flow cases, 10 launch-authorization cases, Git privacy fixtures,
  release-helper fixtures, whitespace and security/privacy checks.
- Manifest, popup badge, README current markers and store-guide upload
  version all match 1.2.1. The five locale files and permissions are unchanged.
- Independent standards/security and spec-fidelity reviews have no open
  actionable findings.
- `ClassGrab.zip`: 16 entries, 63,540 bytes, root manifest at 1.2.1,
  minimum Chromium 127. The exact upload entry set and every payload SHA-256
  match the checkout. It contains no tests, docs, store assets or backup.
- Local ZIP SHA-256:
  `0343494A7107F620237FEDC641B91939D312F7CF0ED0E3C270938910E34126FA`.
  A GitHub ZIP may differ because of checkout line endings; use the fingerprint
  above for this local upload artifact.

Run the optional browser check with the existing local test runtime:

```powershell
node tools/browser-smoke.test.js --playwright 'C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright' --browser '.git\release-audit\stream-1.2.0\browsers\chromium-1234\chrome-win64\chrome.exe'
```

## Manual acceptance and publication

The user confirmed that their signed-in Edge page, after reloading unpacked
v1.2.1 and refreshing Classroom, shows all nine files and replaces the list
when opening another material. This is user-reported acceptance of detection
and switching; the agent did not inspect that browser. Actual downloads,
Chrome, other layouts and store publication still require the checks below.

1. Reload the unpacked ClassGrab extension from
   `D:\USB\Nuke Test Field\classgrab` and refresh Classroom. Disable other
   ClassGrab copies and confirm the popup says **v1.2.1**.
2. On the reported material, confirm all nine attachments appear and download.
   Open another material and confirm its list replaces the first. Repeat a
   completed file to verify the duplicate warning; choose Cancel.
3. Complete the Chrome and Edge checklist in the
   [store submission guide](store-submission.md), including Stream buttons,
   real exports/Drive restrictions, history upgrade, translated UI and native
   download-list visibility.
4. Upload the rebuilt `ClassGrab.zip` to each existing store item. Confirm
   1.2.1 is newer than every submitted version, review listings/privacy/assets,
   submit for review/certification, then verify each store-installed update.

The existing synthetic 1.2.0 Stream screenshot still depicts the unchanged
buttons. A current popup screenshot must show the actual 1.2.1 build; do not
edit a historical badge. Local checks do not verify dashboard fields, store
submission, approval, publication or signed-in browser behavior.

The ignored `deferred-stream-work-20261001.zip` backup is preserved and
excluded from the commit and store package. Historical 1.2.0 and 1.1.7 release
records are retained without rewriting their validation evidence.
