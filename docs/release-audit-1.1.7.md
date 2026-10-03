# ClassGrab 1.1.7 local release audit

Audit date: 1 October 2026. Scope: the README and
[store-submission guide](store-submission.md), production implementation, release
checks, and local upload artifact. **Local validation passes; submission remains
conditional on the manual gates below.** No authenticated Classroom session,
signed-in store dashboard, store approval, or store-installed build was verified.

## Release source and fixes

The starting commit was `33d2c33fda8912c26f0ef9167df70e41efe9fba6`.
The initial release command failed on six unfinished Stream-button tests.
Four development files were preserved, with each archived file's SHA-256 checked,
in `../deferred-stream-work-20261001.zip` and restored to the v1.1.7 baseline
before this audit. That ignored backup is **not a store package**. Stream buttons
remain unfinished and are not included in this release; announcements must be
opened through their own Copy link details page.

This audit made local fixes:

- Reconciliation removes legacy filenames and URLs from still-active tracking
  records while preserving the attachment ID and repeat-download protection.
- Download again skips known active attachments before preparation. The manual
  confirmation path also refreshes history after Drive preparation, skips active
  files and unauthorized completed repeats, and reports history failures without
  opening a fallback tab.
- Release validation checks store-guide version markers, duplicate ZIP entries,
  the archived manifest version, and every packaged file's SHA-256 against the
  checkout. Failure fixtures cover these gates.
- Privacy text explains render-time local link inspection, history pruning on
  the next operation, and legacy record migration. Historical v1.1.1 screenshots
  are marked for replacement.

At the end of the 1 October audit, these fixes were local and uncommitted.
The rebuilt ZIP includes the modified production files; the earlier GitHub
v1.1.7 asset does not include these audit fixes. No commit, push, or store
submission was performed during that audit.

The 3 October follow-up reviews this fix set for a commit and push to the
existing `origin/main`. That source push does not replace the existing v1.1.7
tag or release asset, publish to either store, or complete the manual gates.

## Verified locally

From `D:\USB\Nuke Test Field\classgrab`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\security-check.ps1 -PackagePath .\ClassGrab.zip
```

Node runtime: v24.14.1. The release checks pass JavaScript syntax, bounded batch
preparation, background storage/recovery/duplicate guards, **26** synthetic
content-scope tests, **10** mocked popup-flow tests, Git privacy fixtures, release
failure fixtures, and `git diff --check`. The two new production regressions
failed before their fixes and passed afterward. Independent standards and spec
reviews found the corrected privacy and duplicate issues.

Security validation covers the reviewed permissions/hosts/CSP, five locale files
with 55 required nonempty messages each, common secret/private-ID patterns,
Git identities and remote URLs, PNG text metadata, unsafe packaged HTML APIs,
remote script/style loading, and forbidden package paths. These are specific
static checks, not a guarantee that all possible security issues are absent.

## Upload artifact

- Upload: `D:\USB\Nuke Test Field\classgrab\ClassGrab.zip`.
- Version: **1.1.7**, synchronized across the root manifest, popup badge, README
  badge/package/changelog, and store-guide heading/upload marker.
- ZIP size: **57,796 bytes**. SHA-256:
  `A2DACF5AED0449757C72BA6057A2756357375E83F1F8181D0F1A0F223642C3DB`.
  This fingerprint identifies this local checkout/build; checkout line endings
  can make a later GitHub build's byte hash differ.
- Exactly **15** file entries, no duplicate paths or outer wrapper directory.
- Each archived payload matches its checkout file; manifest-referenced scripts,
  popup, and icons are present. Five locales: `en`, `es`, `fr`, `vi`, `zh_CN`.
- Excludes README/docs, tests/tools, Git metadata, screenshots/store assets,
  private publishing notes, and the deferred Stream-work backup.
- Permissions remain `activeTab`, `downloads`, `storage`; host permissions remain
  Google Drive and Drive usercontent, with the Classroom content-script match.

Local command logs are retained in `.git/release-audit/final-release-validation.log`
and `.git/release-audit/final-security-validation.log`; both commands exited 0.

| Packaged path group | Files |
| --- | ---: |
| `manifest.json` at ZIP root | 1 |
| `icons/16.png`, `32.png`, `48.png`, `128.png` | 4 |
| `scripts/content.js`, `popup.js`, `background.js` | 3 |
| `styles/styles.css`, `views/popup.html` | 2 |
| `_locales/*/messages.json` | 5 |

## Browser checklist comparison

Every row still needs a test of this exact rebuilt package in **both Chrome and
Edge**. Local evidence establishes the implementation's behavior under fixtures;
it does not establish the current authenticated Google DOM or actual downloads.

| Store-guide browser item | Local implementation/evidence | Remaining Chrome and Edge check |
| --- | --- | --- |
| Current post while stream/old content remains mounted | Route/root containment, hidden/foreign-post rejection; content-scope fixtures. | Confirm only the open post's supported files. |
| Announcement's Copy link details page | Headerless `.EE538` shell requires matching post markers; announcement fixtures. | Confirm discovery and an actual download from the announcement link. |
| Back, then a different post | Fresh snapshots replace files; DOM ownership and popup navigation fixtures. | Confirm no previous files persist across actual SPA navigation. |
| Toolbar popup on Stream | Non-post routes return an empty list and opening instructions. | Confirm it never collects the feed. |
| Completed-file duplicate choices | History ID lookup, default Skip focus, explicit Again, Cancel; popup/background fixtures. | Exercise all three choices, including mixed new/completed files. |
| File still downloading | Pre-preparation skip, fresh manual-fallback check, serialized automatic-start guard; active-repeat and timing fixtures. | Attempt repeats from multiple popups, including Again and Drive confirmation. |
| Several new files / unobstructed downloads | Four preparation workers; close only after all acknowledgements and saved tracking, without failures/manual/skips/warnings. | Confirm actual files start once and the browser's downloads UI is visible. |
| Reopen and restore status | Background reconciles browser download IDs; popup applies statuses only to current file IDs. | Confirm completion after popup closure and no unrelated files. |

## Other manual release and store gates

| Requirement | Local result | Remaining action |
| --- | --- | --- |
| Build full upload ZIP, root manifest/version | Passed; complete package and hashes checked. | Use `ClassGrab.zip`, not a source ZIP or the deferred-work backup. |
| Disable other copies, reload, refresh, verify version | Procedure documented; browser state unavailable. | Do this in both browsers before testing. |
| Upgrade preserves usable history | Synthetic legacy migration/restart/duplicate tests pass. | Update an existing test profile without uninstalling; verify repeat warning and legacy metadata cleanup on reconciliation. |
| Actual Drive files and Office exports | Drive and Docs/Sheets/Slides URLs implemented. | Check file contents/names and multi-account behavior, not just download acceptance. |
| Confirmation, restrictions, interrupted downloads | Confirmation parsing, manual path, HTML/failure/tracking cases have mocked tests. | Exercise actual Drive confirmation and denied access; verify visible failure/retry behavior. |
| Localization | All five required message sets present and nonempty. | Review translation and layout, including long filenames/duplicate lists and keyboard focus. File-kind/fallback metadata can still be English. |
| Listing screenshot | Both local images visibly show v1.1.1; store image is 1280x800. | Replace with a fresh, redacted capture of the tested build. Review existing dashboard logos/tiles/screenshots in every language. |
| Privacy and permissions | Manifest/code facts and disclosure reference reviewed locally. | Verify both dashboards' declarations, justified access, and reachable/up-to-date public policy URL. |
| Version accepted by existing items | Local markers agree; published/pending versions unavailable. | Confirm 1.1.7 is newer than each last submitted/published package. Otherwise bump all markers and rebuild. |
| Chrome existing-item package/listing/review | Public update instructions rechecked; no account access. | Upload to the existing item, confirm parsed version, review languages/privacy/distribution/test instructions, submit and select publication timing. Use existing signing flow if Verified CRX Uploads is enabled. |
| Chrome review/deferred publication/rollout | Procedure documented; no review or eligibility checked. | Follow dashboard status, publish within its deferred window if selected, and use percentage rollout only if offered. |
| Edge Packages/Availability/Properties/Privacy/Store listings | Public update instructions rechecked; no account access. | Upload to existing extension, confirm parsed version, complete each locale's description/logo, preserve intended markets/visibility, add certification notes, Publish. |
| Edge certification/resubmission | Procedure documented; no certification checked. | Track status until In the store; cancel and use a higher package version if replacing a submitted package. |
| Store publication and installed copy | Not verified. | Check each public listing and store-installed version, retest with its separate local history, disable unpacked copy, and refresh Classroom. |

The current steps follow the public
[Chrome update documentation](https://developer.chrome.com/docs/webstore/update)
and [Edge update documentation](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).
The detailed [submission guide](store-submission.md) contains the dashboard links,
publication choices, release notes, and reviewer testing text.

## Handoff

Finish the two-browser matrix and replace the screenshot, then complete the
dashboard/privacy/version gates and submit the same validated ZIP to the two
existing listings. Treat package validation, authenticated browser testing,
submission, approval, and publication as separate milestones. Rebuild and repeat
the relevant checks if packaged code or version markers change.
