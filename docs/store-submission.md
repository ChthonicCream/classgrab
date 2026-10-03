# Submit the ClassGrab 1.2.0 update

These instructions update the existing Chrome Web Store and Microsoft Edge
Add-ons listings. Version 1.2.0 is a locally validated package with manual
submission gates still open; pushing code to GitHub does not publish either
store update. Public store procedures were checked against official
documentation on 3 October 2026; neither signed-in dashboard was inspected.

Upload version: `1.2.0`.

See the [release handoff](release-1.2.0.md) for the
verified evidence, fixes, ZIP fingerprint, and remaining manual checks.

The Stream button uses `chrome.action.openPopup`, available to regular
extensions from Chromium 127. The manifest requires version 127 or newer;
update Chrome and Edge before testing. See the
[Chrome action API](https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup).

## Prepare and test the upload

1. Open PowerShell in the repository and build the package:

   ```powershell
   Set-Location 'D:\USB\Nuke Test Field\classgrab'
   powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release.ps1
   ```

2. Continue only after the release command reports success. The upload is
   `D:\USB\Nuke Test Field\classgrab\ClassGrab.zip`. Use this same complete
   package for both stores. Do not upload GitHub's source-code ZIP.
3. Inspect the archive: `manifest.json` must be at its root, with version
   `1.2.0`; the other roots are `icons/`, `scripts/`, `styles/`, `views/`, and
   `_locales/`. There must be no outer `classgrab/` directory. The release
   command checks the packaged files against the tracked upload set.
   It also rejects duplicate ZIP entries and verifies the archived version
   and every entry's bytes against the validated checkout.
   In each dashboard, confirm `1.2.0` is newer than the last submitted/published
   package. If either already uses `1.2.0` or higher, increment all release
   markers and rebuild before uploading changed code.
4. In Chrome, open `chrome://extensions/`; in Edge, open `edge://extensions/`.
   Enable **Developer mode**, select **Load unpacked**, and choose this
   repository folder. For an already loaded development copy, click its
   reload button. Temporarily disable the store copy while testing to avoid
   opening the wrong copy. Confirm the development copy shows `1.2.0`.
5. Refresh the Classroom tab after loading or reloading the extension, then
   run the following checks in both browsers with a test classroom:

   | Check | Expected result |
   | --- | --- |
   | On the Stream, click ClassGrab · Download attachments on an announcement | The popup opens and starts only that card's files, without opening its details. |
   | Click a different Stream card, including one sharing a file with the first | Only the new card's files appear; shared recent files warn instead of silently repeating. |
   | Scroll to load more posts, then go Back/Forward or refresh | One button per eligible card; no buttons or selections leak into another page. |
   | Open a post with attachments while other posts remain in the stream | Only the current post's supported files appear. |
   | From an announcement's three-dot menu, choose Copy link, open that link, then open ClassGrab | Only that announcement's supported files appear. |
   | Go back, open a different post, and reopen ClassGrab | The previous post's files are gone. |
   | Open the toolbar popup on the Stream without clicking a card button | It explains the per-card button/details choices instead of collecting the feed. |
   | Navigate to another post/tab while a slow file is preparing | Files not yet handed to the browser do not start or open manual-confirmation tabs. |
   | Download a file, wait for completion, then try it again | A duplicate warning offers Skip duplicates, Download again, or Cancel; skipping is the default. |
   | Try an attachment that is still downloading | It is not started a second time, including when choosing Download again. |
   | Download several new files | Each starts once; the popup closes after the entire batch starts and tracking is saved, exposing browser downloads. |
   | Reopen ClassGrab after a download | Recent status remains visible without adding unrelated files. |

The unpacked copy and store copy can have separate local history. Complete a
download in the copy being tested before checking its duplicate warning.

The release checks use synthetic DOM and mocked download APIs. The optional
real Chromium smoke test uses an installed extension on synthetic pages with
stubbed downloads; its exact results are in the release handoff. Neither
proves compatibility with your signed-in Classroom or actual Google file
responses. All rows above remain manual checks in **both** Chrome and Edge.
Also test actual Docs/Sheets/Slides exports, Drive manual
confirmation, restricted files, an upgrade retaining old history, and localized
popup layouts. Unknown or ambiguous post layouts return no files; refresh the
page if Classroom has not finished switching posts.

## Chrome Web Store

1. Sign in to the owning account at the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Open the **existing ClassGrab item**. Choose **Package** > **Upload New
   Package**, then select `ClassGrab.zip`. Confirm the parsed version is
   `1.2.0`.
3. Review **Store listing**, **Privacy practices**, and **Distribution**.
   Preserve the existing audience and countries unless you intend a change.
4. Add the release notes below to the listing description if desired. Save
   all changes, review **Test instructions**, and choose **Submit for Review**. This follows Google's
   [existing-item update process](https://developer.chrome.com/docs/webstore/update).
5. In the confirmation dialog, choose when publication should happen:
   leave automatic publication enabled for release after approval, or uncheck
   it to publish manually after approval. A staged approval expires after
   30 days. See [deferred publishing](https://developer.chrome.com/docs/webstore/publish#deferred_publishing_option).
6. Track the review in the dashboard. The existing published version remains
   available during review. Percentage rollout is only offered for eligible
   items with more than 10,000 seven-day active users; it is separate from
   deferred publication. See [update and rollout behavior](https://developer.chrome.com/docs/webstore/update).

If the item already uses **Verified CRX Uploads**, follow its existing signing
process instead of uploading an unsigned ZIP. Google documents this under
[protecting package updates](https://developer.chrome.com/docs/webstore/update#protect_your_package_updates).

## Microsoft Edge Add-ons

1. Sign in to the owning account at [Partner Center's Edge dashboard](https://partner.microsoft.com/dashboard/microsoftedge/overview).
   If you land on Home, open the **Edge** workspace.
2. Open the **existing ClassGrab extension**. In **Packages**, upload the new
   `ClassGrab.zip` using the package upload/replacement control. Resolve any
   validation messages and confirm version `1.2.0`.
3. Review **Availability**, **Properties**, **Privacy**, and **Store listings**;
   save changes. Keep the current markets and visibility unless changing
   distribution deliberately.
4. Choose **Publish**. On the submission page, enter the testing notes below
   in **Notes for certification**, then confirm **Publish**. The package,
   listing, and certification-note fields are described in Microsoft's
   [submission guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
5. Follow the status in **Extension overview**. Microsoft's documented update
   workflow starts certification when you publish and makes the update
   available when the status becomes **In the store**; certification can
   take up to seven business days. Do not assume Chrome's deferred-publication
   option exists here. See the [Edge update process](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).

If you must change a package already under certification, use **Cancel
submission**, upload a higher version, and submit again; this restarts review.
See [updates during certification](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension#update-your-extension-during-the-certification-step).

## Listing languages and images

The ZIP includes English, Spanish, French, Simplified Chinese, and Vietnamese
(`en`, `es`, `fr`, `zh_CN`, `vi`). Those files translate the extension and
manifest metadata. They do not write every store's long description or upload
its screenshots for you.

- **Chrome:** choose each language in the **Store listing** dropdown, review
  its long description and any localized screenshots, and save. Keep feature
  claims consistent across languages. See [listing localization](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#localize_your_listing).
- **Edge:** use **Store listings** > **Edit details** for each language.
  Check the required description and logo; the logo's **Duplicate** option
  can copy it to other languages. Packaged name/short-description changes
  require re-uploading the package. See [per-language listing fields](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-7-enter-store-listing-details-for-each-language).

The new `store-assets/classgrab-stream-1.2.0-1280x800.png` candidate shows
actual 1.2.0 Stream controls on a clearly labelled synthetic example, with no
account connected. Its 1280x800 dimensions fit both stores. Review it after
the live checks before using it in the listing. It is separate from the ZIP.

The old `store-assets/classgrab-store-screenshot-1280x800.png` shows a
**v1.1.1** popup and should not illustrate this update. For a current popup
screenshot, capture the manually tested 1.2.0 build with synthetic or fully
redacted class/account data, retaining the visible version and duplicate UI.
Use a 1280x800 browser capture for both stores. Review dashboard-only images,
logos, and required promotional assets there; their completeness was not
checked locally.

## Suggested release notes

> ClassGrab 1.2.0 adds a Download attachments button to individual Stream
> posts, including announcements. Click it to start only that post's files
> without opening its details. Existing duplicate warnings help prevent
> repeat downloads. Switching posts or tabs during preparation stops files
> that have not started. Successful batches close the popup so the browser's
> download list stays visible. Requires Chromium 127 or newer. No additional
> extension permissions are requested.

## Copy-ready English listing text

**Short description** (also packaged in the English locale):

> Download supported attachments from one Google Classroom post or its Stream card.

**Long description:**

> Save supported attachments from one Google Classroom post at a time.
>
> On the class Stream, click ClassGrab · Download attachments on a post to
> start its files immediately. For individual file selection, open the post's
> details, click the ClassGrab extension icon, select files, and download.
>
> Supports Google Drive files and exports Google Docs, Sheets, and Slides as
> DOCX, XLSX, and PPTX. Duplicate warnings use recent ClassGrab history in the
> same browser profile. Active downloads are skipped; completed files can be
> downloaded again with explicit confirmation. This does not inspect your
> download folder or downloads made outside ClassGrab.
>
> The popup closes after a successful batch starts to reveal the browser's
> download list. It stays open for errors, skipped duplicates, and manual
> confirmation. Unknown Stream card layouts require opening post details.
>
> Requires Google Chrome or Microsoft Edge based on Chromium 127 or newer.
> English, Spanish, French, Simplified Chinese, and Vietnamese UI are included.
> Theme and recent attachment IDs/outcomes stay in local extension storage.
> No ClassGrab server, analytics, or third-party telemetry is used. Downloads
> are requested from Google using your existing signed-in browser session.

Review the translated long descriptions and privacy-policy URL in your
existing dashboards; the packaged translations do not update those fields.

## Reviewer testing notes

Use a test Google Classroom account with access to two posts containing
supported Drive or Google Docs attachments. On the Stream, click the ClassGrab
button on the first post and confirm only its files start. Click the second
post's button and verify its own files are used. A shared completed file
should show the duplicate decision. Cancel that warning and confirm no
extra download starts. Also open the first post's details, open
ClassGrab, and check that only its attachments appear. Navigate back and open
the second post; verify that the list changes to that post's attachments.
Include an announcement: use its three-dot menu > Copy link and open the
copied link to select that post before opening ClassGrab.
Download a file, wait for completion, and attempt it again to exercise the
duplicate warning. Also test opening ClassGrab from the stream itself.

For certification, provide an accessible test classroom/account through the
dashboard's private test-instructions fields if the reviewer requires one.
Do not put credentials, real Classroom links, or student data in the public
listing or repository.

Duplicate detection matches attachment IDs against ClassGrab's recent local
history in this browser profile: up to 100 status records from the last seven
days, pruned on the next status/download operation. Idle storage is not cleared
by a deletion timer. Active browser download ID mappings remain until
reconciliation. Completed or in-progress downloads trigger the warning. **Skip
duplicates** is the default; **Download again** permits another completed
attachment download, while an in-progress attachment remains blocked.
**Cancel** starts nothing. Failed downloads and HTML warning pages can be
retried. A changed file with the same Google ID can also warn; choose
**Download again** when you deliberately want the newer contents.

This is not a scan of the download folder, other/manual browser downloads,
or other devices. Older records can expire or be evicted, and uninstalling
the extension clears its local history. Review the listing's storage
explanation and linked privacy policy for consistency with this behavior.
The update retains the existing
`activeTab`, `downloads`, and `storage` permissions and the existing Drive
host permissions.

## Privacy and permission field reference

Use these implementation facts when reviewing both dashboards' privacy fields
and the existing public privacy-policy URL. Do not infer that local-only data
automatically means no disclosure is needed. Google's
[privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
and Microsoft's [privacy submission fields](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-6-enter-privacy-information)
require disclosures to agree with the extension and policy.

| Field | Current implementation |
| --- | --- |
| Single purpose | Download supported attachments from one Google Classroom post, chosen by its Stream button or open details. |
| `activeTab` | Read and verify the active Classroom tab after the user opens ClassGrab. |
| `downloads` | Start requested downloads and reconcile tracked browser download IDs, completion, and errors. |
| `storage` | Keep recent attachment IDs and outcome metadata, active download ID mappings, and local theme preference. |
| Classroom content-script access | Inspect visible Stream cards and their supported attachment links to place per-post buttons. Return files only from the clicked card or current detail view, and recheck identity before starting. Link text/URLs and short-lived selection tokens remain in tab memory rather than saved status history. |
| Drive host access | Fetch authenticated Drive responses and parse confirmation pages for user-requested downloads. |
| Remote code | None. Packaged scripts render text safely; downloaded Drive HTML is parsed as data, not executed. |
| Data transmission | File requests go to Google using the user's existing browser session. No ClassGrab backend, analytics, or third-party telemetry. The browser itself keeps filenames, URLs, and downloaded contents. |

The public policy URL, dashboard checkbox selections, permission justifications,
test-account access, and all five localized long descriptions require a manual
review. Packaged locale coverage verifies message keys; it does not prove
translated layout or that every Google-provided file label is translated.

The popup automatically closes only after every file in the batch has started
successfully and tracking has been saved. Errors, manual confirmation,
skipped duplicates, and tracking warnings keep it open so the result can be
read. ClassGrab leaves the browser's own download UI enabled.

After each store reports publication, check its public listing and test the
store-installed copy at version `1.2.0`. Re-enable the store copy and disable
the unpacked copy when finished. Refresh open Classroom tabs after the
update. Update repository store-availability claims only after the relevant
store confirms the new version is live.
