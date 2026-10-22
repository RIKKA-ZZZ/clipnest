# Project instructions

- GitHub Pages publishes only `dist/`; the local FFmpeg server is optional and is never executed by Pages.
- Keep relative asset URLs working beneath a project path such as `/clipnest/`.
- The hosted browser mode supports inputs up to 1 GiB; the local FFmpeg mode accepts up to 10 GiB. Do not claim that static hosting provides the local native engine.
- Never commit or publish `.clipnest-cache/`, user media, exported files, credentials, private hosting metadata, or machine-specific paths.
- Keep third-party license notices and engine checksums intact.
- Run `node --check dist/app.js` and `node scripts/check-static.mjs` before publishing.
- Keep the Chinese README's local deployment instructions and software download links current.
- Do not download any individual file above 300 MB; provide its download link instead. Investigate and report blockers.
