# Implementation Steps: `animation-compositor/use-compositor-properties`

Step-by-step instructions for building the plugin described in `PLUGIN_GUIDE.md`.
Verified against this repo's actual conventions (checked `lib/createPlugin.mjs`,
`lib/rules/property-no-vendor-prefix/index.mjs`, `lib/rules/no-unknown-animations/index.mjs`,
`lib/utils/report.mjs`, `docs/developer-guide/plugins.md`, `.editorconfig`, and root `package.json`'s
`jest` block) — a few details below correct or sharpen what's in the guide.

Repo-specific notes that affect the plan:
- Indentation is **tabs** everywhere except `package.json` and `*.md`/`*.css`/`*.yml` (`.editorconfig`).
- Root Jest config restricts `roots` to `lib`, `system-tests`, `.changeset`, and the global `testRule`
  helper is wired up in `jest.setup.mjs` against *this repo's own* `lib/index.mjs`. A plugin living
  outside `lib/` will **not** inherit that global — it needs its own Jest setup (Step 6).
- `report()`'s `fix` option is an **object** (`{ apply, node }`), not a bare function — see
  `property-no-vendor-prefix/index.mjs:87-91`. Passing a bare function still works for the *apply*
  step but skips `computeEditInfo` support, so use the object form.

---

## Step 0 — Scaffold the package

Create it as a standalone package at the repo root (sibling to `lib/`), not inside `lib/rules/`:

```
stylelint-plugin-animation-compositor/
├── package.json
├── jest.config.mjs
├── jest.setup.mjs
├── index.mjs
└── rules/
    └── use-compositor-properties/
        ├── index.mjs
        └── __tests__/
            └── index.mjs
```

`package.json`:

```json
{
  "name": "stylelint-plugin-animation-compositor",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "main": "index.mjs",
  "keywords": ["stylelint", "stylelint-plugin"],
  "peerDependencies": {
    "stylelint": "^17.0.0"
  },
  "devDependencies": {
    "stylelint": "file:..",
    "jest": "^30.4.2",
    "jest-preset-stylelint": "^9.2.0",
    "postcss": "^8.4.0",
    "postcss-value-parser": "^4.2.0"
  }
}
```

`"stylelint": "file:.."` resolves the peer dependency to this local fork during development
(`npm install` inside the plugin directory will symlink it). Use a real semver range if the
plugin is ever published standalone.

Run `cd stylelint-plugin-animation-compositor && npm install` once this file exists.

---

## Step 1 — Plugin entry point (`index.mjs`)

```js
import stylelint from 'stylelint';
import rule from './rules/use-compositor-properties/index.mjs';

export default [stylelint.createPlugin(rule.ruleName, rule)];
```

`createPlugin` (see `lib/createPlugin.mjs`) just wraps `{ ruleName, rule }` — nothing more to
configure here.

---

## Step 2 — Rule skeleton (`rules/use-compositor-properties/index.mjs`)

Follow the shape of `lib/rules/property-no-vendor-prefix/index.mjs` exactly (tabs, `meta.fixable`,
`validateOptions`, `report` with a fix object):

```js
import valueParser from 'postcss-value-parser';
import stylelint from 'stylelint';

const {
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'animation-compositor/use-compositor-properties';

const messages = ruleMessages(ruleName, {
	rejected: (prop, replacement) => `Avoid animating "${prop}", use "${replacement}" instead`,
});

const meta = {
	url: 'https://github.com/<you>/stylelint-plugin-animation-compositor/blob/main/README.md',
	fixable: true,
};

const COMPOSITOR_SAFE = new Set(['opacity', 'transform']);
const CONVERTIBLE = new Set(['left', 'right', 'top', 'bottom']); // width/height handled separately, see Step 5

/** @type {import('stylelint').Rule} */
const rule = (primary, secondaryOptions, context) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, { actual: primary });

		if (!validOptions) return;

		root.walkAtRules(/^-?(webkit|moz|o|ms)?-?keyframes$/i, (atRule) => {
			atRule.walkRules((keyframeRule) => {
				checkKeyframeSelector(keyframeRule, context, result);
			});
		});
	};
};

function checkKeyframeSelector(keyframeRule, context, result) {
	// See Step 3 — collect convertible decls per selector, then report/fix as a group.
}

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;
export default rule;
```

Key corrections vs. the guide's skeleton:
- Match vendor-prefixed `@-webkit-keyframes` etc. too, not just bare `@keyframes`.
- Walk `atRule.walkRules(...)` to get each keyframe selector (`from`, `to`, `50%`) individually —
  merging (Step 5) must happen **per selector**, not across the whole `@keyframes` block, since
  `0% { left: 10px }` and `50% { top: 5px }` are unrelated declarations.

---

## Step 3 — Per-selector declaration pass

Inside `checkKeyframeSelector`, do a single pass to classify declarations before deciding what to
report, because the fix for `left`/`top` depends on whether a `transform` decl already exists in
the same rule and whether both axes are present:

```js
function checkKeyframeSelector(keyframeRule, context, result) {
	/** @type {Map<string, import('postcss').Declaration>} */
	const convertible = new Map(); // 'left' | 'right' | 'top' | 'bottom' -> decl
	let existingTransform;

	keyframeRule.walkDecls((decl) => {
		const prop = decl.prop.toLowerCase();

		if (prop === 'transform') {
			existingTransform = decl;
			return;
		}

		if (CONVERTIBLE.has(prop)) {
			if (containsVar(decl.value)) return; // skip, see Step 6 edge cases
			convertible.set(prop, decl);
		}
	});

	if (convertible.size === 0) return;

	reportAndFix(convertible, existingTransform, keyframeRule, context, result);
}
```

`containsVar` — cheapest correct check is a `postcss-value-parser` walk for a `var()` function
node (a plain substring check on `"var("` is good enough as a first pass, but prefer the parser
so it also treats other unresolvable functions consistently — see Step 6).

---

## Step 4 — Value parsing and the property → transform mapping

Use `postcss-value-parser` to split a value like `10px` into number + unit before building the
replacement function argument:

```js
import valueParser from 'postcss-value-parser';

function parseLength(rawValue) {
	const parsed = valueParser(rawValue);
	const [node] = parsed.nodes;

	if (!node || node.type !== 'word') return null; // not a simple length (e.g. calc(), var())

	return node.value; // keep as string; do not coerce to Number (preserves units, decimals)
}

function negate(rawValue) {
	if (rawValue.startsWith('-')) return rawValue.slice(1);
	if (rawValue.startsWith('+')) return `-${rawValue.slice(1)}`;

	return `-${rawValue}`;
}
```

Mapping table (matches `PLUGIN_GUIDE.md`):

| Property | Compositor replacement            | Sign      |
|----------|------------------------------------|-----------|
| `left`   | `translateX(<value>)`              | as-is     |
| `right`  | `translateX(<value>)`              | negated   |
| `top`    | `translateY(<value>)`              | as-is     |
| `bottom` | `translateY(<value>)`              | negated   |

Only ever emit **one** `transform` decl per selector. Build the `translate()`/`translateX()`/
`translateY()` argument list from whichever of the four convertible props are present:

```js
function buildTranslate(convertible) {
	const x = pickAxisValue(convertible, 'left', 'right');
	const y = pickAxisValue(convertible, 'top', 'bottom');

	if (x != null && y != null) return `translate(${x}, ${y})`;
	if (x != null) return `translateX(${x})`;

	return `translateY(${y})`;
}

function pickAxisValue(convertible, positiveProp, negativeProp) {
	if (convertible.has(positiveProp)) return parseLength(convertible.get(positiveProp).value);
	if (convertible.has(negativeProp)) return negate(parseLength(convertible.get(negativeProp).value));

	return null;
}
```

If both `left` and `right` (or both `top` and `bottom`) are present on the same selector, that's
a contradictory/unusual input — skip conversion for that axis entirely (bail out of the whole
selector, don't guess) rather than silently picking one. Document this as a known limitation.

---

## Step 5 — Reporting and fixing (with `transform` merge + `width`/`height`)

For `left`/`right`/`top`/`bottom`, report once per offending declaration (so message locations are
accurate) but apply the fix once per selector group, since multiple decls collapse into one:

```js
function reportAndFix(convertible, existingTransform, keyframeRule, context, result) {
	for (const [prop, decl] of convertible) {
		report({
			message: messages.rejected,
			messageArgs: [prop, 'transform'],
			node: decl,
			result,
			ruleName,
			fix: {
				apply: () => applyFix(convertible, existingTransform, keyframeRule),
				node: keyframeRule,
			},
		});
	}
}

function applyFix(convertible, existingTransform, keyframeRule) {
	const translate = buildTranslate(convertible);

	if (existingTransform) {
		// Compose: fold the new translate into the existing transform's function list
		// rather than overwriting it, e.g. `scale(2)` -> `scale(2) translateX(10px)`.
		existingTransform.value = `${existingTransform.value} ${translate}`.trim();
	} else {
		keyframeRule.append({ prop: 'transform', value: translate });
	}

	for (const decl of convertible.values()) decl.remove();
}
```

Because `report()`'s internal `isFixApplied` (see `lib/utils/report.mjs:206-224`) calls `apply()`
once per `report()` call whose `fix` is truthy, calling `applyFix` from multiple `report()` calls
for the same selector would double-append the `transform` decl. Guard against this — either:
- only pass the `fix` object on the **first** decl of the group and plain-report (no fix) the
  rest, or
- make `applyFix` idempotent (check `convertible` values are still attached — `decl.parent` is
  falsy after `.remove()` — and no-op if the group was already processed).

The first option is simpler; prefer it.

For `width`/`height` → `scale()`: this is lossy (requires knowing the element's base size, which
a static lint pass cannot know), so **do not autofix it**. Only report it (no `fix` in the
`report()` call), with a message pointing out that the conversion requires a known base dimension
and manual `transform-origin` consideration.

---

## Step 6 — Edge cases checklist

Implement and write a test for each:

- [ ] `var(...)` in the value → skip (no report, no fix). Check with `postcss-value-parser`,
  looking for a `function` node with `value === 'var'`.
- [ ] `calc(...)` in the value → treat like `var()` for now (skip); note as a documented
  limitation rather than attempting arithmetic.
- [ ] Both `left` and `top` in the same selector → merge into one `translate(x, y)`.
- [ ] Only one axis present → `translateX()`/`translateY()`, not `translate()` with a `0`.
- [ ] `right`/`bottom` → sign inversion via `negate()`.
- [ ] Existing `transform` in the same selector → append via string composition, never overwrite.
- [ ] `opacity` → accept as-is, never reported.
- [ ] Vendor-prefixed `@-webkit-keyframes` → still walked and checked.
- [ ] `!important` on a convertible decl → decide (recommend: skip and don't autofix, since
  moving `!important` semantics onto a synthesized `transform` is surprising) and document it.
- [ ] Both `left` and `right` present on the same selector (contradictory) → skip that axis,
  don't guess.

---

## Step 7 — Tests (`rules/use-compositor-properties/__tests__/index.mjs`)

Because this plugin is outside root Jest's `roots`, it needs its own Jest config
(`jest.config.mjs` at the plugin root) and its own `testRule` global, pointed at the peer
`stylelint` (which resolves to `file:..`, i.e., this fork):

`jest.config.mjs`:

```js
export default {
	preset: 'jest-preset-stylelint',
	testEnvironment: 'node',
	setupFiles: ['<rootDir>/jest.setup.mjs'],
	testRegex: 'rules/.*/__tests__/.*\\.mjs$',
};
```

`jest.setup.mjs`:

```js
import jestPreset from 'jest-preset-stylelint';
import stylelint from 'stylelint';
import plugin from './index.mjs';

const { getTestRule } = jestPreset;

global.testRule = getTestRule({
	plugins: [plugin],
	loadLint: () => Promise.resolve(stylelint.lint),
});
```

(Check the installed `jest-preset-stylelint` version's `getTestRule` signature — some versions
take `plugins` via the per-test schema instead of the factory options; if so, pass
`plugins: [plugin]` inside each `testRule({...})` call instead, per the `docs/developer-guide/plugins.md`
testing example.)

Test file:

```js
import rule from '../index.mjs';

const { messages, ruleName } = rule;

testRule({
	ruleName,
	config: [true],
	fix: true,

	accept: [
		{ code: '@keyframes a { from { transform: translateX(0) } }' },
		{ code: '@keyframes a { from { opacity: 0 } }' },
		{ code: '@keyframes a { from { left: var(--x) } }', description: 'skips CSS variables' },
	],

	reject: [
		{
			code: '@keyframes a { from { left: 10px } }',
			fixed: '@keyframes a { from { transform: translateX(10px) } }',
			message: messages.rejected('left', 'transform'),
		},
		{
			code: '@keyframes a { from { right: 10px } }',
			fixed: '@keyframes a { from { transform: translateX(-10px) } }',
			message: messages.rejected('right', 'transform'),
		},
		{
			code: '@keyframes a { from { left: 10px; top: 5px } }',
			fixed: '@keyframes a { from { transform: translate(10px, 5px) } }',
			warnings: 2,
			description: 'merges both axes into one transform',
		},
		{
			code: '@keyframes a { from { transform: scale(2); left: 10px } }',
			fixed: '@keyframes a { from { transform: scale(2) translateX(10px) } }',
			message: messages.rejected('left', 'transform'),
			description: 'composes with an existing transform instead of overwriting it',
		},
	],
});
```

Run with: `cd stylelint-plugin-animation-compositor && npx jest`.

---

## Step 8 — Manual verification

From the plugin directory, lint a sample file directly against the fork's CLI to sanity-check
real-world behavior beyond the unit tests:

```sh
cd stylelint-plugin-animation-compositor
echo '@keyframes slide { from { left: 0; top: 0 } to { left: 100px; top: 50px } }' > /tmp/test.css
node ../bin/stylelint.mjs --config '{"plugins":["./index.mjs"],"rules":{"animation-compositor/use-compositor-properties":true}}' /tmp/test.css
node ../bin/stylelint.mjs --fix --config '{"plugins":["./index.mjs"],"rules":{"animation-compositor/use-compositor-properties":true}}' /tmp/test.css && cat /tmp/test.css
```

---

## Step 9 — Docs

Add a `README.md` to the plugin directory documenting: the rule name
(`animation-compositor/use-compositor-properties`), config usage, the conversion table, the
known limitations (no `calc()`/`var()` support, `width`/`height` reported but not autofixed,
contradictory axis pairs skipped) — this doubles as thesis-writeup material on the tool's scope.
