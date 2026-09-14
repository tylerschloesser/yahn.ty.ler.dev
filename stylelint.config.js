/**
 * Two layers, enforced by lint:
 *
 *   src/styles/**   — the token layer. Raw hex/px are allowed here, and only here.
 *   *.module.css    — component styles. Every value must be a token.
 *
 * @type {import('stylelint').Config}
 */
export default {
  extends: [
    'stylelint-config-standard',
    'stylelint-config-css-modules',
    'stylelint-config-recess-order',
  ],
  plugins: [
    '@double-great/stylelint-a11y',
    'stylelint-value-no-unknown-custom-properties',
    '@css-modules-kit/stylelint-plugin',
  ],
  rules: {
    // Every var() must resolve to a token we actually define.
    'csstools/value-no-unknown-custom-properties': [
      true,
      {
        importFrom: ['src/styles/tokens.css'],
      },
    ],
    'a11y/no-outline-none': true,

    // Bare specifiers are how Vite resolves CSS from node_modules, and url()
    // notation does not resolve them.
    'import-notation': 'string',

    // Off deliberately: the rule predates :focus-visible and demands a literal
    // :focus next to every :hover, which would ring elements on mouse click.
    // base.css carries one global :focus-visible rule instead.
    'a11y/selector-pseudo-class-focus': null,
  },
  overrides: [
    {
      files: ['**/*.module.css'],
      extends: ['@css-modules-kit/stylelint-plugin/recommended'],
      rules: {
        // Class names are read as `styles.someClass`, so camelCase rather than
        // the kebab-case stylelint-config-standard expects.
        'selector-class-pattern': [
          '^[a-z][a-zA-Z0-9]*$',
          { message: 'Expected class selector to be camelCase' },
        ],
        'declaration-property-value-disallowed-list': {
          '/color$|^fill$|^stroke$/': ['/^#/', '/^rgba?\\(/', '/^hsla?\\(/'],
          '/^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)/':
            ['/\\dpx/'],
          '/radius/': ['/\\dpx/'],
        },
      },
    },
  ],
}
