# stylelint-plugin-animation-compositor

A [Stylelint](https://stylelint.io) plugin that flags properties animated inside `@keyframes` which force the browser to run layout or paint on the main thread, and — where it can be done losslessly — auto-fixes them to their compositor-only `transform` equivalents.

Animating `left`, `top`, `right`, `bottom`, `width`, or `height` invalidates layout on every frame. Animating `transform` and `opacity` instead lets the browser promote the work to the compositor thread, keeping animations smooth even when the main thread is busy.

## Rules

The plugin provides a single rule: `animation-compositor/use-compositor-properties`.

## Installation and usage

Inside this repository the plugin resolves the local Stylelint fork via `"stylelint": "file:.."`:

```sh
cd stylelint-plugin-animation-compositor
npm install
```

Add it to a Stylelint config:

```json
{
  "plugins": ["./stylelint-plugin-animation-compositor/index.mjs"],
  "rules": {
    "animation-compositor/use-compositor-properties": true
  }
}
```

The primary option is `true`; there are no secondary options.

## What it checks

Only declarations inside `@keyframes` blocks (including vendor-prefixed `@-webkit-keyframes`, `@-moz-keyframes`, `@-o-keyframes`, and `@-ms-keyframes`) are checked. The same properties outside keyframes are ignored — a static `left` is fine; an *animated* one is not.

| Animated property | Replacement                | Auto-fixed | Sign     |
| ----------------- | -------------------------- | ---------- | -------- |
| `left`            | `transform: translateX()`  | yes        | as-is    |
| `right`           | `transform: translateX()`  | yes        | inverted |
| `top`             | `transform: translateY()`  | yes        | as-is    |
| `bottom`          | `transform: translateY()`  | yes        | inverted |
| `width`, `height` | `transform: scale()`       | no         | —        |
| `opacity`, `transform` | already compositor-safe | —         | —        |

## Fix behavior

```css
/* Before */
@keyframes slide {
  from { left: 0; top: 0 }
  to { left: 100px; top: 50px }
}

/* After --fix */
@keyframes slide {
  from { transform: translate(0, 0) }
  to { transform: translate(100px, 50px) }
}
```

- **Axis merging** — `left`/`right` and `top`/`bottom` in the same keyframe selector collapse into a single `translate(x, y)`. A single axis produces `translateX()` or `translateY()`, never a padded `translate(x, 0)`.
- **Existing `transform`** — the translation is appended to the existing function list (`scale(2)` becomes `scale(2) translateX(10px)`) rather than overwriting it. `transform: none` is replaced outright.
- **Sign inversion** — `right: 10px` becomes `translateX(-10px)`; `bottom: -2em` becomes `translateY(2em)`; zero stays unsigned.
- **Duplicates** — repeated declarations of the same property are all removed, and the cascade winner (the last one) provides the value.
- **One warning per declaration, one fix per selector** — every offending declaration is reported at its own location, but the whole group is rewritten in a single edit.

## Known limitations

These cases are deliberately skipped (no report, no fix) because a static lint pass cannot produce a provably equivalent rewrite:

- **`var()` and `calc()` values** — the resolved value is unknown at lint time; no arithmetic is attempted.
- **Percentages** — `left: 50%` resolves against the *containing block*, while `translateX(50%)` resolves against the *element's own box*. The two are only coincidentally equal, so no conversion is made.
- **Keywords and multi-value shorthands** — `left: auto`, `inherit`, etc. have no translation equivalent.
- **`!important`** — browsers ignore `!important` declarations inside `@keyframes` entirely, so there is nothing to convert.
- **Contradictory axis pairs** — `left` and `right` (or `top` and `bottom`) together describe a stretched box, not a movement; the selector is left untouched rather than guessing an axis.

Further caveats:

- **`width`/`height` are report-only.** Converting them to `scale()` requires knowing the element's base size and adjusting `transform-origin`, which is out of reach for static analysis — the rule points this out in its message instead of fixing.
- **Composition order is an approximation.** The synthesized translation is appended *after* existing transform functions, so it operates in the already-transformed coordinate space: after `scale(2)`, a `translateX(10px)` moves the element 20 visual pixels. The original `left: 10px` always moved exactly 10px. Review composed results manually.
- **Positioning context is not modeled.** `left` on a `position: static` element does nothing, and on an absolutely positioned element it interacts with its containing block; `translate` always moves the element. The rule assumes the animation was meant to move the element visually.

## Tests

```sh
cd stylelint-plugin-animation-compositor
npm test
```

The suite is Jest-based (`jest-preset-stylelint`) and self-contained — it does not depend on the parent repository's Jest configuration.
