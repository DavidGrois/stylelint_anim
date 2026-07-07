# Stylelint Plugin: Animation Compositor Properties

A guide for implementing a Stylelint plugin that flags and auto-fixes CSS animations to use compositor-only properties (e.g. `left: 10px` → `transform: translateX(10px)`).

---

## How a Stylelint Plugin Works

A plugin is a standalone npm package (or local directory) that wraps one or more rules. It uses the same internal rule API as built-in rules, just namespaced.

The rule execution pipeline:
1. PostCSS parses the CSS into an AST
2. Your rule receives `(primary, secondaryOptions, context)` and returns a walker `(root, result) => void`
3. The walker traverses AST nodes, reports problems, and optionally mutates nodes to auto-fix

---

## Files to Create

Since this is a standalone plugin (not a built-in rule), create it outside the `lib/rules/` tree — either as a separate package or a local directory.

```
stylelint-plugin-animation-compositor/
├── package.json
├── index.mjs                          ← plugin entry point
└── rules/
    └── use-compositor-properties/
        ├── index.mjs                  ← rule implementation
        └── __tests__/
            └── index.mjs              ← tests
```

### `index.mjs` — Plugin entry point

```js
import stylelint from 'stylelint';
import rule from './rules/use-compositor-properties/index.mjs';

export default [stylelint.createPlugin(rule.ruleName, rule)];
```

### `rules/use-compositor-properties/index.mjs` — The rule

```js
import stylelint from 'stylelint';

const { report, ruleMessages, validateOptions } = stylelint.utils;

const ruleName = 'animation-compositor/use-compositor-properties';
const messages = ruleMessages(ruleName, {
  rejected: (prop, fix) => `Avoid animating "${prop}", use "${fix}" instead`,
});
const meta = { url: '...', fixable: true };

const rule = (primary, secondaryOptions, context) => {
  return (root, result) => {
    const validOptions = validateOptions(result, ruleName, { actual: primary });
    if (!validOptions) return;

    // Walk @keyframes blocks only
    root.walkAtRules('keyframes', (atRule) => {
      atRule.walkDecls((decl) => {
        // Check if decl.prop is a non-compositor property (left, top, etc.)
        // Report and optionally mutate decl.prop / decl.value to fix
      });
    });
  };
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;
export default rule;
```

Key implementation points:
- Use `root.walkAtRules('keyframes', ...)` to scope checks to animation blocks
- `decl.prop` gives the property name (`left`, `top`, etc.)
- `decl.value` gives the value (`10px`)
- For auto-fix: mutate `decl.prop` and `decl.value` directly, and pass a `fix` callback to `report()`
- Use `postcss-value-parser` to parse values like `10px` into number + unit before building `translateX(10px)`

### `rules/use-compositor-properties/__tests__/index.mjs` — Tests

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
  ],
  reject: [
    {
      code: '@keyframes a { from { left: 10px } }',
      fixed: '@keyframes a { from { transform: translateX(10px) } }',
      message: messages.rejected('left', 'transform: translateX()'),
    },
  ],
});
```

---

## Key Repo Files to Reference

| File | Why it's useful |
|------|----------------|
| `lib/createPlugin.mjs` | Wraps your rule into a plugin |
| `lib/rules/property-no-vendor-prefix/index.mjs` | Best example of a fixable property-rewriting rule |
| `lib/rules/no-unknown-animations/index.mjs` | Shows how to walk `@keyframes` and animation declarations |
| `lib/utils/report.mjs` | How to report a problem with a fix callback |
| `lib/utils/getDeclarationValue.mjs` | Safe read of declaration values (respects `raws`) |
| `lib/utils/setDeclarationValue.mjs` | Safe write of declaration values |
| `docs/developer-guide/plugins.md` | Official plugin authoring guide |

---

## Value Transformation Logic

The core challenge is mapping non-compositor properties to their compositor equivalents:

| Animated property | Compositor replacement |
|-------------------|----------------------|
| `left` | `transform: translateX(value)` |
| `right` | `transform: translateX(-value)` |
| `top` | `transform: translateY(value)` |
| `bottom` | `transform: translateY(-value)` |
| `opacity` | already compositor-safe, no change needed |
| `width` / `height` | `transform: scale()` (lossy, requires care) |

### Edge cases to handle

- **Merging**: if both `left` and `top` are animated in the same keyframe selector, they must merge into a single `transform: translate(x, y)` rather than two separate `transform` declarations
- **Units**: parse the value with `postcss-value-parser` to extract the number and unit before constructing the replacement
- **Negative values**: `right: 10px` and `bottom: 10px` invert the sign
- **Variables**: skip declarations whose value is a CSS custom property (`var(--x)`) since the value is unknown at lint time
- **Existing transform**: if the keyframe already has a `transform`, the new translation must be composed with it rather than overwriting it
