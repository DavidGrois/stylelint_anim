import jestPreset from 'jest-preset-stylelint';

import plugin from './index.mjs';

const { getTestRule } = jestPreset;

global.testRule = getTestRule({
	plugins: [plugin],
	loadLint: () => import('stylelint').then((m) => m.default.lint),
});
