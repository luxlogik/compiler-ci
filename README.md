# compiler-ci

Shard tests by historical timings, plan the shard count and find affected packages in JavaScript and TypeScript repositories. A GitHub Action and a zero-dependency Node CLI (Node 20+).

```yaml
jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
      - id: plan
        uses: luxlogik/compiler-ci@v1
        with: { command: plan, runner: vitest, target-minutes: 5 }
  test:
    needs: plan
    runs-on: ubuntu-latest
    strategy:
      matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v4
      - id: files
        uses: luxlogik/compiler-ci@v1
        with: { command: shard, runner: vitest, total: "${{ strategy.job-total }}", index: "${{ matrix.shard }}" }
      - run: npx vitest run ${{ steps.files.outputs.result }}
```

Commands: `shard`, `plan`, `affected`. Full documentation: https://github.com/luxlogik/compiler/blob/main/docs/compiler-ci.md

This repository is a published copy of `tools/compiler-ci` in luxlogik/compiler; send changes there.
