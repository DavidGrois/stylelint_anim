import rule from '../index.mjs';

const { messages, ruleName } = rule;

testRule({
	ruleName,
	config: [true],
	fix: true,

	accept: [
		{
			code: '@keyframes a { from { transform: translateX(0) } }',
		},
		{
			code: '@keyframes a { from { opacity: 0 } to { opacity: 1 } }',
			description: 'opacity is compositor-safe',
		},
		{
			code: 'a { left: 10px }',
			description: 'ignores declarations outside @keyframes',
		},
		{
			code: '@keyframes a { from { left: var(--x) } }',
			description: 'skips CSS variables',
		},
		{
			code: '@keyframes a { from { left: calc(100% - 10px) } }',
			description: 'skips calc() values',
		},
		{
			code: '@keyframes a { from { left: 50% } }',
			description: 'skips percentages, which are not equivalent in transform space',
		},
		{
			code: '@keyframes a { from { left: auto } }',
			description: 'skips keyword values',
		},
		{
			code: '@keyframes a { from { left: 10px !important } }',
			description: 'skips !important, which browsers ignore inside @keyframes',
		},
		{
			code: '@keyframes a { from { left: 0; right: 10px } }',
			description: 'skips contradictory horizontal offsets',
		},
		{
			code: '@keyframes a { from { top: 0; bottom: 10px } }',
			description: 'skips contradictory vertical offsets',
		},
	],

	reject: [
		{
			code: '@keyframes a { from { left: 10px } }',
			fixed: '@keyframes a { from { transform: translateX(10px) } }',
			message: messages.rejected('left', 'transform'),
			description: 'left maps to translateX()',
		},
		{
			code: '@keyframes a { from { right: 10px } }',
			fixed: '@keyframes a { from { transform: translateX(-10px) } }',
			message: messages.rejected('right', 'transform'),
			description: 'right maps to translateX() with the sign inverted',
		},
		{
			code: '@keyframes a { from { top: 5px } }',
			fixed: '@keyframes a { from { transform: translateY(5px) } }',
			message: messages.rejected('top', 'transform'),
			description: 'top maps to translateY()',
		},
		{
			code: '@keyframes a { from { bottom: -2em } }',
			fixed: '@keyframes a { from { transform: translateY(2em) } }',
			message: messages.rejected('bottom', 'transform'),
			description: 'negating bottom drops an existing minus sign',
		},
		{
			code: '@keyframes a { from { right: 0 } }',
			fixed: '@keyframes a { from { transform: translateX(0) } }',
			message: messages.rejected('right', 'transform'),
			description: 'zero stays unsigned when inverted',
		},
		{
			code: '@keyframes a { from { left: 10px; top: 5px } }',
			fixed: '@keyframes a { from { transform: translate(10px, 5px) } }',
			warnings: [
				{ message: messages.rejected('left', 'transform') },
				{ message: messages.rejected('top', 'transform') },
			],
			description: 'merges both axes into one transform',
		},
		{
			code: '@keyframes a { from { transform: scale(2); left: 10px } }',
			fixed: '@keyframes a { from { transform: scale(2) translateX(10px) } }',
			message: messages.rejected('left', 'transform'),
			description: 'composes with an existing transform instead of overwriting it',
		},
		{
			code: '@keyframes a { from { transform: none; left: 10px } }',
			fixed: '@keyframes a { from { transform: translateX(10px) } }',
			message: messages.rejected('left', 'transform'),
			description: 'replaces transform: none instead of composing with it',
		},
		{
			code: '@-webkit-keyframes a { from { left: 10px } }',
			fixed: '@-webkit-keyframes a { from { transform: translateX(10px) } }',
			message: messages.rejected('left', 'transform'),
			description: 'checks vendor-prefixed keyframes at-rules',
		},
		{
			code: '@keyframes slide { from { left: 0 } to { left: 100px } }',
			fixed: '@keyframes slide { from { transform: translateX(0) } to { transform: translateX(100px) } }',
			warnings: [
				{ message: messages.rejected('left', 'transform') },
				{ message: messages.rejected('left', 'transform') },
			],
			description: 'converts each keyframe selector independently',
		},
		{
			code: '@keyframes a { from { left: 10px; left: 20px } }',
			fixed: '@keyframes a { from { transform: translateX(20px) } }',
			warnings: [
				{ message: messages.rejected('left', 'transform') },
				{ message: messages.rejected('left', 'transform') },
			],
			description: 'removes duplicates and keeps the cascade winner',
		},
		{
			code: '@keyframes a { from { width: 100px } }',
			unfixable: true,
			message: messages.rejectedLossy('width'),
			description: 'width is reported but not auto-fixed',
		},
		{
			code: '@keyframes a { to { height: 50vh } }',
			unfixable: true,
			message: messages.rejectedLossy('height'),
			description: 'height is reported but not auto-fixed',
		},
		{
			code: '@keyframes a { from { width: 100px; left: 10px } }',
			fixed: '@keyframes a { from { width: 100px; transform: translateX(10px) } }',
			warnings: [
				{ message: messages.rejectedLossy('width') },
				{ message: messages.rejected('left', 'transform') },
			],
			description: 'a lossy report does not block fixing the convertible group',
		},
	],
});
