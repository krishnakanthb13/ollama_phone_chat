# Third-Party Notices

The frontend bundles the following libraries in `public/vendor/` so the app can
run on a LAN without internet access and under a strict `script-src 'self'`
Content Security Policy. They are unmodified upstream distribution files.

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

To update a library, replace the file with the pinned version from the
official npm package, update the version, hash, and license files here, and
bump the `?v=` query string in `public/index.html`.
