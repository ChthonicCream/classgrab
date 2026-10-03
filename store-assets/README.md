# Store Assets

Listing images live here. These files are separate from the
extension package and are not included in `ClassGrab.zip`.

The current **1.2.0 candidate** is a real Chromium rendering of the installed
extension's Stream controls on a synthetic fixture, unchanged in 1.2.1. It
prominently says no account is connected and all class/post/file data is fictional. Review it
after the signed-in Chrome/Edge checks before uploading.

The older popup screenshot shows **v1.1.1**, omits current statuses and the
popup-closing hint, and should not represent this update. Capture a current
1.2.1 popup in a 1280x800 browser frame after the manual checks. Use synthetic
or fully redacted data. Do not edit an old version badge to imply a test.

## Screenshots

- `classgrab-stream-1.2.0-1280x800.png`: current Stream button candidate,
  `1280x800`, captured by `tools/browser-smoke.test.js` from the synthetic fixture.
- `classgrab-store-screenshot-1280x800.png`: historical v1.1.1 popup,
  `1280x800`; retained as historical material.

Chrome accepts screenshots at `1280x800` or `640x400`. Microsoft Edge Add-ons
accepts screenshots at `1280x800` or `640x480`. Use the `1280x800` image for
both stores for the replacement capture. Existing dashboard assets still need
an accuracy review; their presence or approval was not checked locally.

Before upload, visually confirm raster screenshots do not expose real student,
teacher, account, classroom URL, or private-comment information.

## Current candidate provenance

The optional smoke test loads the real unpacked extension into an isolated
Chromium profile, intercepts the synthetic Classroom page, and captures the
result at 1280x800. The screenshot is copied without image alterations.
Real download acceptance/history is stubbed in that test; no authenticated
Classroom or store verification is implied. See `docs/release-1.2.0.md`.

## Historical Screenshot Process

The current store screenshot was exported from the redacted README preview at
`assets/classgrab-preview.png`. It was cropped from the left edge to preserve
the Classroom page context, the full ClassGrab popup, and visible attachment
file names, then resized to `1280x800`.

The visible Classroom URL, class name, assignment title, teacher name, account
avatar, and private-comment target were redacted. Attachment file names were
intentionally left visible.
