export default {
	preset: 'jest-preset-stylelint',
	testEnvironment: 'node',
	setupFiles: ['<rootDir>/jest.setup.mjs'],
	testRegex: 'rules/.*/__tests__/.*\\.mjs$',
};
