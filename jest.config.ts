import type { JestConfigWithTsJest } from 'ts-jest';

const jestConfig: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'convex/tsconfig.json', useESM: true }],
  },
  moduleNameMapper: {
    // Stub Convex generated server so pure functions can be unit-tested without a live Convex runtime.
    '^\\.\\./\\_generated/server$': '<rootDir>/convex/__mocks__/_generated/server.ts',
    '^\\./\\_generated/server$': '<rootDir>/convex/__mocks__/_generated/server.ts',
  },
};
export default jestConfig;
