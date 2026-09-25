# Submit the ClassGrab 1.1.5 update

These instructions update the existing Chrome Web Store and Microsoft Edge
Add-ons listings. Version 1.1.5 is a prepared release; pushing code to GitHub
does not publish either store update. Store procedures were checked against
official documentation on 24 September 2026.

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
   `1.1.5`; the other roots are `icons/`, `scripts/`, `styles/`, `views/`, and
   `_locales/`. There must be no outer `classgrab/` directory. The release
   command checks the packaged files against the tracked upload set.
4. In Chrome, open `chrome://extensions/`; in Edge, open `edge://extensions/`.
   Enable **Developer mode**, select **Load unpacked**, and choose this
   repository folder. For an already loaded development copy, click its
   reload button. Temporarily disable the store copy while testing to avoid
   opening the wrong copy. Confirm the development copy shows `1.1.5`.
5. Refresh the Classroom tab after loading or reloading the extension, then
   run the following checks in both browsers with a test classroom:

   | Check | Expected result |
   | --- | --- |
   | Open a post with attachments while other posts remain in the stream | Only the current post's supported files appear. |
   | Go back, open a different post, and reopen ClassGrab | The previous post's files are gone. |
   | Open ClassGrab on the stream without opening a post | It asks you to open a post instead of collecting the stream. |
   | Download a file, wait for completion, then try it again | A duplicate warning offers Skip duplicates, Download again, or Cancel; skipping is the default. |
   | Try an attachment that is still downloading | It is not started a second time, including when choosing Download again. |
   | Download several new files | Each starts once; the popup closes after the entire batch starts and tracking is saved, exposing browser downloads. |
   | Reopen ClassGrab after a download | Recent status remains visible without adding unrelated files. |

The unpacked copy and store copy can have separate local history. Complete a
download in the copy being tested before checking its duplicate warning.

The automated checks use synthetic Classroom DOM fixtures and mocked browser
download APIs. The popup was also visually checked in a local browser preview.
A signed-in Classroom session and the native Chrome/Edge download bubble were
not available during this build, so complete the live checks above before store
submission. Unknown or ambiguous post layouts return no files; refresh the page
if Classroom has not finished switching posts.

## Chrome Web Store

1. Sign in to the owning account at the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Open the **existing ClassGrab item**. Choose **Package** > **Upload New
   Package**, then select `ClassGrab.zip`. Confirm the parsed version is
   `1.1.5`.
3. Review **Store listing**, **Privacy practices**, and **Distribution**.
   Preserve the existing audience and countries unless you intend a change.
4. Add the release notes below to the listing description if desired. Save
   all changes and choose **Submit for Review**. This follows Google's
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
   validation messages and confirm version `1.1.5`.
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

The existing `store-assets/classgrab-store-screenshot-1280x800.png` is a
separate listing asset, not part of the ZIP. Review it against the new UI
before reusing it; replace outdated feature screenshots with redacted images
from the tested build. Existing accurate listing images can remain.

## Suggested release notes

> ClassGrab 1.1.5 fixes missing attachment detection on assignment details
> pages without card metadata. Downloads stay limited to the
> current Classroom post. Navigating between posts no longer carries forward
> the previous post's attachment list. Duplicate-download warnings help you
> avoid downloading the same attachment again. Once all downloads in a batch
> start successfully, the popup closes to uncover the browser's download
> controls. No additional extension permissions are requested.

## Reviewer testing notes

Use a test Google Classroom account with access to two posts containing
supported Drive or Google Docs attachments. Open the first post, open
ClassGrab, and check that only its attachments appear. Navigate back and open
the second post; verify that the list changes to that post's attachments.
Download a file, wait for completion, and attempt it again to exercise the
duplicate warning. Also test opening ClassGrab from the stream itself.

Duplicate detection matches attachment IDs against ClassGrab's recent local
history in this browser profile: up to 100 status records from the last seven
days. Completed or in-progress downloads trigger the warning. **Skip
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

The popup automatically closes only after every file in the batch has started
successfully and tracking has been saved. Errors, manual confirmation,
skipped duplicates, and tracking warnings keep it open so the result can be
read. ClassGrab leaves the browser's own download UI enabled.

After each store reports publication, check its public listing and test the
store-installed copy at version `1.1.5`. Re-enable the store copy and disable
the unpacked copy when finished. Refresh open Classroom tabs after the
update. Update repository store-availability claims only after the relevant
store confirms the new version is live.
