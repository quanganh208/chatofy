# Auto-Detection Logic

Detect test runner, version file, and changelog format from project files.

## Test Runner Detection

Check in order (first match wins):

| Check | Test Command |
|-------|-------------|
| `package.json` → `scripts.test` exists | `npm test` |
| `Makefile` → has `test:` target | `make test` |
| `pytest.ini` OR `pyproject.toml` has `[tool.pytest]` | `pytest` |
| `Cargo.toml` exists | `cargo test` |
| `go.mod` exists | `go test ./...` |
| `Gemfile` + `Rakefile` with test task | `bundle exec rake test` |
| `build.gradle` or `build.gradle.kts` | `./gradlew test` |
| `pom.xml` | `mvn test` |
| `mix.exs` | `mix test` |
| `deno.json` | `deno test` |

## Version File Detection

Check in order; skip the version bump when none exists:

| Check | Read Pattern |
|-------|-------------|
| `VERSION` file | Read as semver string |
| `package.json` → `version` field | `jq -r .version package.json` |
| `pyproject.toml` → `version` | grep `version = "..."` |
| `Cargo.toml` → `version` | grep `version = "..."` |
| `mix.exs` → `@version` | grep `@version "..."` |

## Changelog Detection

Use `CHANGELOG.md`, `CHANGES.md`, or `HISTORY.md` in keep-a-changelog format
(`## [X.Y.Z] - YYYY-MM-DD` with Added / Changed / Fixed / Removed); skip when
none exists.
