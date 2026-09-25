# ADR 001: Deploy the monorepo's build artifact directly to Pages

Status: accepted, 2026-09-25.

## Context

The project needs a built static website now and may need a Chrome extension later. The initial proposal was a source repository with a nested Pages repository/submodule; the request also explicitly allowed a better monorepo approach.

## Decision

Use one npm workspace repository with `apps/web`, `packages/sync-core`, and `packages/providers`. Reserve `apps/extension` as a future location. Deploy the generated `apps/web/dist` through GitHub's official Pages artifact workflow, with no generated files committed and no submodule.

## Consequences

One pull request can modify shared contracts and consumers atomically. Deployment needs only the workflow's scoped GitHub token, avoiding a cross-repository write credential and submodule pointer updates. The website retains the repository Pages URL. A future extension can build a separate artifact from the same source tree without coupling its release to the site. A second repository is appropriate only if ownership or release access needs to be separated later.
