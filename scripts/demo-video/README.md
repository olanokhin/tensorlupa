# Demo video

The hero video on the landing page, its poster and the GIF in the repository README are recorded by a script, so
they can be redone after any change of the interface.

1. Start the local site: `python3 serve.py 8765`.
2. Run `record.js` with Playwright (it is one function that takes `page`). It opens the studio at 1440×900 in the
   Lab, plays the scenario described at the top of the file and saves one JPEG per frame, 30 per second of video,
   into the folder named in `DIR`. The page clock is replaced, so the frame rate does not depend on how fast the
   frames are taken; the generation time shown on screen is still measured with the real clock.
3. Build the files: `POSTER_AT=11.5 sh scripts/demo-video/encode.sh <folder with frames>`. It needs `ffmpeg` and
   writes `web/media/demo.mp4`, `web/media/demo-poster.jpg` and `docs/demo.gif`.
