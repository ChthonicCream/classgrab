# ClassGrab Extension

A modern, sleek browser extension to download multiple files from Google Classroom with a single click. Save time by bulk downloading attachments from assignments, announcements, and posts without opening each file manually.

---

## Features

- **One-Click Bulk Download**: Download all files in a Google Classroom announcement or assignment.
- **Select Specific Files**: Checkboxes let you filter exactly which files to download.
- **Clean Naming & Preservation**: Preserves original file extensions and cleans up filenames.
- **Dark Mode**: Supports system-wide dark mode for a unified browser experience.

---

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open your browser's Extension Management page:
   - For **Chrome**: Navigate to `chrome://extensions/`
   - For **Edge**: Navigate to `edge://extensions/`
3. Enable **Developer mode** using the toggle switch (usually top right).
4. Click **Load unpacked** and select the root directory of this extension folder (`classgrab`).
5. Pin the extension to your toolbar for easy access.

---

## Usage

1. Open any Google Classroom page with multiple file attachments.
2. Click the **ClassGrab** extension icon in your toolbar.
3. Your files will be listed with checkboxes.
4. Click **Download Selected** or **Download All**.

---

## FAQ

### 1. The extension downloads `.htm` files instead of the actual files
This happens when download permissions are restricted by the owner of the document (your teacher or school administrator). Ask them to enable download/print permissions for viewers.

### 2. Some files are missing
Currently, the extension is optimized for Google Drive file attachments. Unsupported third-party links or embedded YouTube videos will not show up in the download list.
