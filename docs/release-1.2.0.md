# ClassGrab 1.2.0 release handoff

Scope: add an immediate-download button to each identifiable Classroom Stream
post with supported attachments, including announcements. Each button chooses
one card. The toolbar continues to scan only an open detail view. Version
1.2.0 retains the v1.1.7 duplicate/history protections and popup closure.

## Implementation and acceptance

- Buttons use the observed `.n4xnA` Stream boundary and require one visible
  post identity in the current course. Hidden, foreign, duplicate, or ambiguous
  cards do not receive buttons. Lazy-rendered cards are refreshed without
  accumulating controls.
- A trusted click creates a private, expiring selection token. The background
  validates the sender and pins the source tab/window/document; the popup
  consumes its launch once and asks for the selected card explicitly.
- A normal toolbar popup on the Stream stays empty. It cannot select a card
  automatically or adopt files from neighboring posts.
- Downloads pass through the existing history decision and atomic background
  guard. In-progress files cannot be started again; completed files require
  the existing explicit repeat choice.
- The original post is checked again after Drive preparation, before either
  a browser download or a manual-confirmation tab. Changing the post, tab,
  document, or selected card blocks files that have not started.
- Successful batches close the popup. Duplicate decisions, manual confirmation,
  errors, or tracking warnings keep it visible. The browser download UI stays
  enabled.
- All five packaged locales include Stream controls. No permissions were
  added. `minimum_chrome_version` is 127 for the
  [popup API](https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup).

## Reproducible local validation

Run from `D:\USB\Nuke Test Field\classgrab`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release.ps1
```

This runs syntax, content scope, launch authorization, popup decisions,
concurrent preparation, storage/duplicate reconciliation, Git privacy, locale,
version-marker, and release-helper checks. Packaging verifies the root
manifest, exact tracked entry set, duplicate-entry exclusion, and every entry's
SHA-256 against the checkout, then runs the security/privacy gate.

The real Chromium smoke test is opt-in; its browser/runtime paths are supplied
explicitly. It uses an isolated profile, synthetic Classroom pages and stubbed
browser downloads, with network access blocked. It does not sign in to Google
or submit to a store. See the test's header for its command.

Verified locally on 3 October 2026:

- Full `tools/release.ps1` command passed. The content scanner has 32 passing
  cases, popup flow has 19, and launch authorization has 10. The separate
  download-batch and background-storage suites also passed, as did the Git
  privacy and release-helper fixtures.
- Independent standards/security and spec reviews have no open findings.
  A manual-confirmation navigation race found in review was reproduced with
  a failing test, fixed, and retested.
- Manifest, popup badge, README markers, and store-guide upload version all
  match 1.2.0. All five locale files have 59 keys with matching placeholders.
- `ClassGrab.zip`: 16 entries, 63,542 bytes, root manifest at 1.2.0, minimum
  Chromium 127. Every payload hash matches the validated checkout; no outer
  directory, backup, tests, documentation, or store images are included.
- Local ZIP SHA-256:
  `CA14568F3751DC49E27DD6B93E8B46433A77202C57C4D74C8C5B0113F4193188`.
  GitHub's ZIP can differ because CI uses different checkout line endings.

The optional real browser check passed all 8 Node checks (one parent and seven
subtests), exit 0, on Chromium 151.0.7922.34. It verified real content-script
injection and DOM visibility, trusted clicks, extension messaging, source
document targeting, `action.openPopup`, installed popup rendering, scoped
auto-start, popup closure, switching cards, duplicate Cancel, changed-card
rejection, and observer cleanup without script exceptions. Only download
acceptance/history and Google response bytes were stubbed; the extension's
runtime, local storage, action APIs and DOM were genuine. Network requests were
intercepted/blocked and the profile had no Google account.

Run the same optional check with the installed test runtime:

```powershell
node tools/browser-smoke.test.js --playwright 'C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright' --browser '.git\release-audit\stream-1.2.0\browsers\chromium-1234\chrome-win64\chrome.exe'
```

`store-assets/classgrab-stream-1.2.0-1280x800.png` is a visually checked
1280x800 capture of actual content controls on this synthetic fixture. It is
labelled as a demo and has no real account, course, teacher, or file data. It
is a listing candidate, not proof of authenticated Classroom compatibility.
Native-size current popup captures are retained in the ignored local test
artifacts; a store popup capture still needs a 1280x800 frame.

The historical `deferred-stream-work-20261001.zip` remains an ignored local
backup. It is neither committed nor included in the release ZIP. Its partial
work was used selectively as a reference; the current implementation preserves
the later audited fixes.

## Remaining publication checks

| Gate | Owner/action |
| --- | --- |
| Signed-in Chrome and Edge | Reload unpacked 1.2.0, refresh Classroom, run every row in the store guide on real posts. Verify actual downloads and file contents. |
| Drive restrictions and exports | Test actual Docs/Sheets/Slides, large/flagged files, blocked downloads, and manual confirmations. |
| Browser download display | Observe real popup closure and the native download list in both browsers. |
| Upgrade and localization | Test existing local history and all five UI layouts. |
| Listing assets | Replace historical v1.1.1 images; review current candidates and any dashboard-only logos/promotional images. |
| Dashboard and privacy | Confirm 1.2.0 exceeds every previously submitted version. Review policy URL, disclosures, permissions, market/audience settings, and localized long descriptions. |
| Submission and publication | Upload the complete ZIP to each existing item, submit/certify, and follow the resulting status. No dashboard submission or approval is verified by local tests. |
| Store-installed verification | After each store publishes, disable unpacked copies, install/update the store copy, confirm 1.2.0, refresh Classroom, and repeat the main flow. |

The [store submission guide](store-submission.md) includes dashboard steps,
copy-ready listing text, release notes, reviewer instructions, and privacy
justifications. GitHub releases and store publication are separate operations.
