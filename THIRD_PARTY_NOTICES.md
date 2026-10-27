# Third-Party Notices

The frontend bundles the following libraries and fonts in `public/` so the app
can run on a LAN without internet access and under a strict `script-src 'self'`
and `font-src 'self'` Content Security Policy. They are unmodified upstream
distribution files.

## marked

- Version: 18.1.2
- File: `public/vendor/marked.umd.js`
- License: MIT
- Source: <https://github.com/markedjs/marked>
- License text: `public/vendor/LICENSE.marked.txt`
- SHA-256: `9EB730D2362AE1A8C6201698F17009E16671BE6946D3D06503DDC0575283DB7C`

## DOMPurify

- Version: 3.4.17
- File: `public/vendor/purify.min.js`
- License: Apache-2.0 OR MPL-2.0
- Source: <https://github.com/cure53/DOMPurify>
- License text: `public/vendor/LICENSE.dompurify.txt` and
  `public/vendor/LICENSE.dompurify-MPL.txt`
- SHA-256: `CD37898F9782ADF54820C413191B5691803F0F137C799D6EDCFD38523B4C2C31`

## Bricolage Grotesque Variable

- Version: 5.3.0 (`@fontsource-variable/bricolage-grotesque`)
- File: `public/vendor/fonts/bricolage-grotesque-latin.woff2`
  (latin subset, `wght` 200–800 variable axis)
- License: SIL Open Font License 1.1
- Copyright: 2022 The Bricolage Grotesque Project Authors
- Source: <https://github.com/ateliertriay/bricolage>
- License text: `public/vendor/fonts/LICENSE.bricolage-grotesque.txt`
- SHA-256: `A97804DC9FBE5FC972A08018C5EDA4DAB7EF2346F64C57E61419D05E6DE4EA1C`

## Instrument Sans Variable

- Version: 5.3.0 (`@fontsource-variable/instrument-sans`)
- File: `public/vendor/fonts/instrument-sans-latin.woff2`
  (latin subset, `wght` 400–700 variable axis)
- License: SIL Open Font License 1.1
- Copyright: 2022 The Instrument Sans Project Authors
- Source: <https://github.com/Instrument/instrument-sans>
- License text: `public/vendor/fonts/LICENSE.instrument-sans.txt`
- SHA-256: `2EE17598A98D8A59E4DF8152D015BEC9AB8E4D5672CC0AB42BEF806B568E3971`

The SIL Open Font License requires the license text to travel with the font
files, which is why each family keeps its own `LICENSE.*.txt` next to the
`.woff2` it covers.

To update a library or font, replace the file with the pinned version from the
official npm package, update the version, hash, and license files here, and
bump the `?v=` query string in `public/index.html` (styles.css and app.js).
