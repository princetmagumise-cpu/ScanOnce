# ScanOnce

Scan, convert, compress, OCR, protect and organize documents on your **iPhone** and **Windows laptop**, from one app.
All processing happens on your device. Files are never uploaded.

ScanOnce is an installable web app (PWA). You build it once and it runs on both platforms, works offline, and gets its own icon and window.

## Features

| Area | What it does |
| --- | --- |
| **Scan to PDF** | Camera or photos, automatic page detection, drag-the-corners perspective correction, rotate, Auto / Grayscale / Black & white filters, A4 / Letter / fit, optional searchable text (OCR) |
| **Convert** | PDF ⇄ Word, PDF ⇄ Excel, PDF ⇄ PowerPoint, Word ⇄ Excel ⇄ PowerPoint, images → PDF/Word/PowerPoint, PDF → JPG, anything → text. PDF input can be rebuilt as editable text and tables, or kept as an "exact look" copy |
| **Merge** | PDFs and images into one PDF, in any order (drag or use arrows) |
| **Split** | Every page, every N pages, custom ranges (`1-3, 4-6, 7-`), or pick pages |
| **Organize** | Reorder, rotate, delete, duplicate pages, insert blank pages, add pages from another PDF |
| **Extract** | All text (.txt), every embedded image at original quality, or selected pages |
| **Compress** | Light (lossless), Balanced, Strong (re-encodes images, text stays selectable), Maximum (flattens pages to images) |
| **OCR PDF** | Makes scanned PDFs and photos searchable and copyable (13 languages, two at once) |
| **Repair** | Recovers damaged PDFs: rebuilds the structure, recovers objects, and as a last resort redraws the pages that can still be read |
| **Protect PDF** | Adds or removes a standard AES-256 password. Optional print, copy and edit restrictions |
| **Lock any file** | Password-locks Word, Excel, PowerPoint, photos or any other file (AES-256-GCM, PBKDF2 600k). Unlock in ScanOnce |

## Install on your devices

The app needs to be served over HTTPS once. After that it's cached and works offline.

1. **Publish it** (free): in GitHub go to **Settings → Pages** and set **Source = GitHub Actions**. Then merge to `main`. The included workflow tests, builds and deploys it to `https://<your-user>.github.io/ScanOnce/`.
   (GitHub Pages on a private repo requires a paid plan. Otherwise you can make the repo public, or deploy the `dist/` folder to Netlify, Cloudflare Pages or Vercel.)
2. **iPhone**: open the link in **Safari** → Share → **Add to Home Screen**.
3. **Windows**: open the link in **Edge** or **Chrome** → the install icon in the address bar (or ⋯ → Apps → **Install ScanOnce**). It appears in the Start menu and runs in its own window.

On iPhone, use **Share → Save to Files** on a result to keep it in the Files app.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # conversion, security, merge/split, repair and OCR-layer tests
npm run build    # production build in dist/
npm run preview  # serve the build
```

Main libraries: pdf-lib (PDF editing), pdf.js (rendering and text), qpdf compiled to WebAssembly (encryption and optimisation), tesseract.js (OCR), docx / mammoth (Word), ExcelJS (Excel), PptxGenJS / JSZip (PowerPoint).

### How conversion works

Every reader (`src/lib/readers`) turns a file into a small, format-neutral `DocModel` (headings, paragraphs, lists, tables, images, one section per page, slide or sheet). Every writer (`src/lib/writers`) turns a `DocModel` into a file. This is what makes any-to-any conversion possible.

## Limits worth knowing

- Conversions keep **content and structure** (text, headings, lists, tables, images), not every font, colour and exact position. Use "Exact look" when a PDF's appearance matters more than editing it.
- Only modern Office files (`.docx`, `.xlsx`, `.pptx`) are supported, not the old `.doc`, `.xls` or `.ppt` formats.
- OCR downloads its engine and language data the first time you use it (needs internet once).
- Locked `.locked` files open only in ScanOnce. For a PDF that other people must open in any app, use **Protect PDF**.
