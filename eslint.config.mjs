import next from "eslint-config-next";

/** Flat config. eslint-config-next (v16) ships a native flat-config array. */
const eslintConfig = [
  ...next,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
