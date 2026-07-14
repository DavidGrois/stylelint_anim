import stylelint from 'stylelint';
import valueParser from 'postcss-value-parser';

const {
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'animation-compositor/use-compositor-properties';

const messages = ruleMessages(ruleName, {
	rejected: (prop, replacement) => `Avoid animating "${prop}", use "${replacement}" instead`,
	rejectedLossy: (prop) =>
		`Avoid animating "${prop}", use "transform: scale()" instead (requires a known base ${prop} and a "transform-origin" review, so it is not auto-fixed)`,
});

const meta = {
	url: 'https://github.com/DavidGrois/stylelint_anim/blob/main/stylelint-plugin-animation-compositor/README.md',
	fixable: true,
};

const KEYFRAMES_NAME = /^(-(webkit|moz|o|ms)-)?keyframes$/i;

const CONVERTIBLE_PROPS = new Set(['left', 'right', 'top', 'bottom']);
const LOSSY_PROPS = new Set(['width', 'height']);

/** @type {import('stylelint').Rule} */
const rule = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, { actual: primary });

		if (!validOptions) return;

		root.walkAtRules(KEYFRAMES_NAME, (atRule) => {
			atRule.walkRules((keyframeRule) => {
				checkKeyframeSelector(keyframeRule, result);
			});
		});
	};
};

/**
 * @param {import('postcss').Rule} keyframeRule
 * @param {import('stylelint').PostcssResult} result
 */
function checkKeyframeSelector(keyframeRule, result) {
	/** @type {Array<{ decl: import('postcss').Declaration, prop: string, lossy: boolean }>} */
	const flagged = [];
	/** @type {Map<string, string>} */
	const lengths = new Map();
	/** @type {import('postcss').Declaration | undefined} */
	let transformDecl;

	keyframeRule.walkDecls((decl) => {
		const prop = decl.prop.toLowerCase();

		// Browsers ignore `!important` declarations inside @keyframes,
		// so these never animate and are not worth converting.
		if (decl.important) return;

		if (prop === 'transform') {
			transformDecl = decl;

			return;
		}

		if (LOSSY_PROPS.has(prop)) {
			flagged.push({ decl, prop, lossy: true });

			return;
		}

		if (!CONVERTIBLE_PROPS.has(prop)) return;

		const length = convertibleLength(decl.value);

		if (length == null) return;

		// The last declaration wins the cascade, but every duplicate is flagged.
		lengths.set(prop, length);
		flagged.push({ decl, prop, lossy: false });
	});

	if (flagged.length === 0) return;

	// `left`+`right` (or `top`+`bottom`) together describe a stretched box,
	// not a translation — bail out instead of guessing an axis value.
	const contradictory =
		(lengths.has('left') && lengths.has('right')) || (lengths.has('top') && lengths.has('bottom'));

	// One shared fix per keyframe selector: several declarations collapse into
	// a single `transform`, and `report()` calls `apply()` once per problem.
	let applied = false;

	const applyFix = () => {
		if (applied) return;

		applied = true;

		const translate = buildTranslate(lengths);

		if (transformDecl) {
			transformDecl.value = composeTransform(transformDecl.value, translate);
		} else {
			keyframeRule.append({ prop: 'transform', value: translate });
		}

		for (const { decl, lossy } of flagged) {
			if (!lossy) decl.remove();
		}
	};

	for (const { decl, prop, lossy } of flagged) {
		if (lossy) {
			report({
				message: messages.rejectedLossy,
				messageArgs: [prop],
				node: decl,
				result,
				ruleName,
			});

			continue;
		}

		if (contradictory) continue;

		report({
			message: messages.rejected,
			messageArgs: [prop, 'transform'],
			node: decl,
			result,
			ruleName,
			fix: {
				apply: applyFix,
				node: keyframeRule,
			},
		});
	}
}

/**
 * Extract a value usable verbatim as a `translate()` argument: a single
 * length or unitless number. Returns `null` for anything else — `var()`,
 * `calc()`, keywords, percentages, multiple values.
 *
 * Percentages are excluded because `left: 50%` resolves against the
 * containing block while `translateX(50%)` resolves against the element's
 * own box — the two are not equivalent.
 *
 * @param {string} value
 * @returns {string | null}
 */
function convertibleLength(value) {
	const { nodes } = valueParser(value);

	if (nodes.length !== 1) return null;

	const [node] = nodes;

	if (!node || node.type !== 'word') return null;

	const dimension = valueParser.unit(node.value);

	if (!dimension || dimension.unit === '%') return null;

	return node.value;
}

/**
 * @param {Map<string, string>} lengths
 * @returns {string}
 */
function buildTranslate(lengths) {
	const x = axisValue(lengths, 'left', 'right');
	const y = axisValue(lengths, 'top', 'bottom');

	if (x != null && y != null) return `translate(${x}, ${y})`;

	if (x != null) return `translateX(${x})`;

	return `translateY(${y})`;
}

/**
 * @param {Map<string, string>} lengths
 * @param {string} positiveProp
 * @param {string} negativeProp
 * @returns {string | null}
 */
function axisValue(lengths, positiveProp, negativeProp) {
	const positive = lengths.get(positiveProp);

	if (positive != null) return positive;

	const negative = lengths.get(negativeProp);

	if (negative != null) return negate(negative);

	return null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function negate(value) {
	if (Number.parseFloat(value) === 0) return value;

	if (value.startsWith('-')) return value.slice(1);

	if (value.startsWith('+')) return `-${value.slice(1)}`;

	return `-${value}`;
}

/**
 * @param {string} existingValue
 * @param {string} translate
 * @returns {string}
 */
function composeTransform(existingValue, translate) {
	const existing = existingValue.trim();

	if (existing.length === 0 || existing.toLowerCase() === 'none') return translate;

	return `${existing} ${translate}`;
}

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;
export default rule;
