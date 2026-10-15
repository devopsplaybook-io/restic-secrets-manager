module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx|js|mjs)$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2020",
        },
      },
    ],
  },
  // cookie@2 is ESM-only and is require()d by light-my-request under Jest
  transformIgnorePatterns: ["/node_modules/(?!(cookie)/)"],
  coverageProvider: "v8",
  moduleNameMapper: {
    "^uuid$": "<rootDir>/src/__mocks__/uuid.ts",
    "^content-disposition$": "<rootDir>/src/__mocks__/content-disposition.js",
  },
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
};
