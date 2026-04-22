import type { Config } from 'jest';
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  clearMocks: true,
  rootDir: '.',
  testMatch: ['**/test/**/*.spec.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/worker.ts'],
  coverageThreshold: {
    global: { statements: 85, branches: 80, functions: 85, lines: 85 },
  },
  moduleNameMapper: { '^@examplehr/contracts$': '<rootDir>/../../packages/contracts/src' },
};
export default config;
