import stylelint from 'stylelint';

import rule from './rules/use-compositor-properties/index.mjs';

export default [stylelint.createPlugin(rule.ruleName, rule)];
