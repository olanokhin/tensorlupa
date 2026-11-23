# Screenshots for Docs

All screenshots of the Docs articles are taken by one scenario, `shots.js`, for any language of the studio.

1. Start the local site: `python3 serve.py 8765`.
2. Prepare the scenario for a language: `sh scripts/docs-shots/prepare.sh ru` writes a copy of `shots.js` with the
   language filled in (optionally a list of names: `sh scripts/docs-shots/prepare.sh ru mlp,logits`).
3. Run that copy with Playwright (it is one function that takes `page`). It saves PNG files into a
   `shots-<language>` folder.
4. Convert: `sh scripts/docs-shots/convert.sh ru <folder with PNG files>`. English images go to
   `docsite/src/assets/`, other languages to `docsite/src/assets/<language>/`. It needs `cwebp`.

A new article with a screenshot is one more line in `SHOTS` at the top of `shots.js`.
