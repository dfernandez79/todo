Default to using Bun instead of Node.js:

- `bun <file>` instead of `node <file>`
- `bun test` instead of `jest` or `vitest`
- `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or
  `pnpm run <script>`
- `bunx <package> <command>` instead of `npx <package> <command>`

## Domain

The spec is `docs/todo-spec.md`, the terms are in `GLOSSARY.md`, and decisions
are in `docs/adr/`. Use the glossary's terms (List, Item, Item ID, Section,
Duplicate Item, Prompt) in code, docs and messages.

## Runtime

The package ships `dist/todo.js` (the command) and `dist/index.js` (the
TypeScript API), built by [bunup](https://bunup.dev) (`bun run build`) to run on
Node.js >= 22.16. So the code it bundles, everything under `src/` but the tests
and `src/test-helpers/`, must not use Bun's APIs: use `node:` modules,
`node:sqlite` for SQLite, and `postgres` for PostgreSQL. oxlint rejects the
`Bun` global and imports from `bun` there. Tests run on Bun and may use both.
`src/todo.test.ts` builds the package and runs its command on Node.

## Tests

`bun test` runs every store test on SQLite and on PostgreSQL, in a
testcontainers database that needs Docker. `bun run test:unit` skips PostgreSQL.

## Linting and formatting

This project uses [oxlint](https://oxc.rs) for linting and
[oxfmt](https://oxc.rs) for formatting. Rules and format options come from the
shared `@diegoux/oxc-config` package (`oxlint.config.ts`, `oxfmt.config.ts`);
only project-specific overrides belong in those files.

```sh
bun run lint       # report lint problems
bun run lint:fix   # apply auto-fixable lint problems
bun run fmt        # format all files in place
bun run fmt:check  # check formatting without writing
```

**After making any code change, run `bun run fmt` and `bun run lint`, and fix
everything they report before considering the change done.**
