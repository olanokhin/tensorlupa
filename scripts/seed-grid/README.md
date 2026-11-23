# Seed grid

How the default seeds of the studio are picked: generate one prompt with many seeds, keep the stories that pass
simple checks, then read the best ones.

`completion.js` is a function for Playwright. With the local site running (`python3 serve.py 8765`) it opens the
studio, runs the listed prompts with seeds 1 to 1500 at the studio's default settings, and returns for each prompt:
how many stories ended on their own, how many passed (ended on its own, at most two repeated three-word phrases, no
repeated sentence, 70 to 150 tokens) and the text of the best ones.

- The 8-bit or 4-bit model is chosen by `q=8` or `q=4` in the address inside the file.
- Results in use: Completion mode, "Once upon a time": seed 1246 (8-bit), 633 (4-bit), see `COMPLETION_SEED` in
  `web/editor.js`. Docs examples: "Once upon a time, a little dog" 1149; the request text in Completion mode 1231.
- The Instruct presets (`PICKS_ALL` in `web/editor.js`) were picked the same way, with one more check: all requested
  words are in the story.
