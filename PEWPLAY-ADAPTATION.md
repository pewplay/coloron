# Coloron for PewPlay

This directory contains the original static game adapted for the PewPlay game template. Open `index.html` to play.

`game.json` holds the game page text. `preview.png` and `cover.png` provide the page images. The PewPlay workflow checks pushes to `preview` and `main`. The game remains a draft until you remove `"draft": true` after reviewing it.

Game controls: Watch the color of the bouncing ball and switch the bar to the same color before it lands.

## Update (October 2026)

- Rewrote `script.js` without jQuery and GSAP (both were loaded from CDNs, as were all the scenery images from greghub.github.io): the game is now drawn on a full-screen high-DPI canvas with the same rules, timings and speed-up table. The scenery (sun, clouds, mountains, waves, bar patterns) is redrawn in code, so there are no external requests.
- Responsive in every orientation (portrait zooms out so several bars ahead are always visible); resizing no longer ends the run.
- Instant touch input with Pointer Events; each bar owns its whole column as tap area.
- Pause button, P/Esc, auto-pause when the page is hidden; best score saved under `coloron:best`.
- New cover and screenshots.
