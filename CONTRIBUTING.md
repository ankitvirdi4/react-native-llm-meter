# Contributing

Thanks for your interest in `react-native-llm-meter`! This project is in early
pre release. Feedback, ideas, and PRs are all very welcome.

## Setup

```bash
git clone https://github.com/ankitvirdi4/react-native-llm-meter.git
cd react-native-llm-meter
npm install
```

## Development

```bash
npm run dev         # tsup watch build
npm run build       # one-off build into dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest
```

## Submitting a PR

1. Fork the repo and create a branch off `main`.
2. Make your change. Keep PRs focused. One concern per PR.
3. Add or update tests where it makes sense.
4. Make sure `npm run typecheck`, `npm test`, and `npm run build` all pass.
5. Open a PR with a clear summary of the *why*.

Small PRs land faster. If you're planning something larger, open an issue first
so we can chat about the approach.

## Good first issues

Check the [good first issue](https://github.com/ankitvirdi4/react-native-llm-meter/labels/good%20first%20issue)
label for beginner friendly tasks. If nothing's there yet, open an issue
describing what you'd like to work on and we'll scope something together.

## Releasing (maintainers only)

1. Bump `version` in `package.json` and the `VERSION` constant in `src/index.ts`. Update the matching test in `src/index.test.ts`.
2. Add a section to `CHANGELOG.md` describing the changes.
3. Run `npm run typecheck`, `npm test`, `npm run build`. All must pass.
4. Commit on `main`, tag the release: `git tag -a vX.Y.Z -m "vX.Y.Z, ..."`.
5. Push: `git push origin main && git push origin vX.Y.Z`.
6. Publish to npm: `npm publish --access public`.
7. Create the GitHub release with `gh release create vX.Y.Z --title "..." --notes "..."`.

## Code of conduct

By participating, you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Questions?

Open a [discussion](https://github.com/ankitvirdi4/react-native-llm-meter/discussions)
or reach out via the repo.
