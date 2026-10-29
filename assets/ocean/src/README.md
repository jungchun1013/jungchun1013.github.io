# web-ocean fork (site banner)

Source of `../ocean.html`, forked from https://github.com/noniv/web-ocean (MIT, Maksymilian Dendura).

Changes vs upstream:
- `main.js`: water body colour = prussian-blue, crest subsurface colour = stormy-teal (linear, scaled);
  defaults tuned for a calm magic-hour sea; new `warmth` and `grade` parameters.
- `wgsl/post.js`: luminance-indexed palette grade (imperial-blue, rosewood, honey-bronze, jasmine)
  blended in after tone mapping, strength = `grade`.

Rebuild: copy these files over a clone of upstream (`js/main.js`, `js/wgsl/*.js`), run `node build.mjs`,
then prepend the pause/fail hook (see the top of `../ocean.html`) to `ocean.min.html`.
