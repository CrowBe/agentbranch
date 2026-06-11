import next from "eslint-config-next";

/** Flat config. eslint-config-next (v16) ships a native flat-config array. */
const eslintConfig = [
  ...next,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]",
          message:
            "Unsafe raw SQL is banned. Use Prisma's query builder or add a justified lint exception for reviewed parameterized SQL.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^\\$(queryRaw|executeRaw)$/], TaggedTemplateExpression[tag.property.name=/^\\$(queryRaw|executeRaw)$/]",
          message:
            "Raw SQL requires an explicit, reviewed lint exception. Prefer Prisma's query builder.",
        },
      ],
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
