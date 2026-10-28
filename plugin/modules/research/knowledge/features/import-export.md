# Import and export

Lets a person bring their data in from a file or another app, and take a full copy of it out whenever they want.

## Sub-features a complete version needs

- Import from common files (CSV, JSON, and any format the field uses, such as Markdown or calendar files), by drag and drop or a file picker.
- A preview before import: the first rows, the detected columns, and how many items will be created.
- Column mapping: match file columns to app fields, with guesses filled in and a way to skip a column.
- Checks before writing (required fields, dates, numbers, duplicates); rows with problems are listed with row number and reason.
- A duplicate rule: skip, update the existing item, or create a copy.
- Large imports run in the background with progress, and can be cancelled.
- A summary at the end (created, updated, skipped, failed), with the failed rows as a download.
- Undo the last import (removes what it created) for a set time.
- Export everything or the current view (with filters applied), in CSV and JSON at least.
- Export includes attached files or links to them, and says what is left out.
- Account-wide "Download my data" for privacy laws, if the app has accounts.
- Export file names include the app name and date (for example `notes-2026-10-07.csv`).
- Backend split (fwos does not build backends):
  - Frontend owns: pickers, preview, mapping, checks, progress, summary, and the whole job for data that already lives on the device.
  - Large files, data stored on a server, and full account exports need a hosted backend or existing API to accept uploads, process them in the background, and return a download link.

## States every screen must show

- Empty (zero): the import screen lists the accepted formats and offers a sample file to download.
- Loading: reading and checking the file shows a progress bar with rows done out of the total.
- Preview: what will happen, before anything is written.
- Partial data: some rows failed; the summary lists them and the good rows are kept.
- Error (with reason + retry): wrong file type, file too big (with the limit), or unreadable text encoding, with a way to pick another file.
- Offline: local import and export still work; server-based ones are disabled with a note.
- No permission: people who cannot add items cannot import, and the button says why.
- Success: counts of what was created, and a link to see the new items.

## Edge cases

- A CSV saved by a spreadsheet app in an older text encoding, or with a byte order mark: accented names still come through right.
- The file uses semicolons instead of commas, or has quoted fields with line breaks inside: it is read correctly.
- A date like `03/04/2026`: the app asks whether it is March 4 or April 3 instead of guessing silently.
- A 100,000-row file: the page stays responsive and the import can be cancelled.
- The same file is imported twice: the duplicate rule applies and nothing is doubled silently.
- An exported CSV is opened in a spreadsheet: cells starting with `=`, `+`, `-` or `@` are escaped so they cannot run as formulas.
- Text with commas, quotes and line breaks is exported and imported back with no changes (round trip).
- An empty file, or one with only a header row: the app says there is nothing to import.
- The person leaves the page during import: the import continues in the background or stops cleanly with a note, never half done in silence.

## Platform conventions

- **Web**
  - Use a file input plus a visible drop area; both work with the keyboard.
  - Read large files in chunks in a Web Worker so the page does not freeze.
  - Create downloads from a Blob with a clear file name; the File System Access API is optional and missing in some browsers.
- **Electron (desktop)**
  - Use the native open and save dialogs, remember the last folder, and add "Import..." and "Export..." to the File menu.
  - Accept files dropped on the window or on the dock icon.
  - Read and write files in the main process; the page gets only the result.
- **Mac (SwiftUI)**
  - Use `.fileImporter` and `.fileExporter` with declared content types, and add "Import..." and "Export..." to the File menu.
  - Sandboxed apps can open only files the person picks; save a security-scoped bookmark to reopen the same file later.
  - Support drag and drop from Finder with `Transferable`.

## Questions to settle in discovery

- Which apps or files will people most often bring data from? Default: CSV plus the app's own JSON format. Why: almost every tool can save CSV, and JSON keeps everything for a round trip.
- When an imported row matches an item that already exists, what should happen? Default: skip it and list it in the summary. Why: it never overwrites someone's work by surprise.
- Should export include attached files (images, documents) or only text? Default: text and data, with attachments in a separate zip if there are any. Why: the main export stays small and quick.
- How big can an import be? Default: 10 MB or 50,000 rows in the first release. Why: that covers most personal and small-team data without a server.

## Acceptance criteria starters

### AC-import-export-1: Preview before writing
- Given I choose a valid CSV with 20 rows, when the file is read, then I see the column mapping and "20 items will be created" before anything is saved.
- Proven against: local

### AC-import-export-2: Bad rows are listed and good rows are kept
- Given a CSV where row 7 has an invalid date, when I import it, then the other rows are created and the summary names row 7 and the reason.
- Proven against: local

### AC-import-export-3: Export round trip loses nothing
- Given items with commas, quotes and line breaks in their text, when I export to CSV and import that file into an empty account, then every item matches the original.
- Proven against: local

### AC-import-export-4: Formulas are escaped in exports
- Given an item whose title starts with "=", when I export to CSV and open the file in a spreadsheet, then the cell shows the title as text.
- Proven against: local

### AC-import-export-5: Undo the last import
- Given I just imported 50 items, when I choose "Undo import", then those 50 items are removed and items that existed before stay.
- Proven against: local
