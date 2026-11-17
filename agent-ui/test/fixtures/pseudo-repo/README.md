# Pseudo repositories for the Analyses (whitebox) agent

Two small Kotlin services with a change that has seeded defects. Use them to check that the agent really finds what it should, without a company Jira or repositories.

- `billing-svc`: limit rules and invoicing. Branch `feature/DEMO-101-max-open-orders` adds the field `maxOpenOrders`.
- `orders-svc`: creates orders and calls billing-svc. It has no change of its own: it is the consumer that the change forgot.
- `DEMO-101.md`: the ticket text. Paste it as the task (there is no Jira in this setup, and the agent works without one).
- `expected.json`: the 7 seeded defects (D1 to D7) and one clean area. D3 and D4 can only be found by reading the other service, D5 and D6 only by looking outside the change.

## Run it

```
node test/fixtures/pseudo-repo/build.js <durable-folder>/out --data-dir <durable-folder>/data
QA_DATA_DIR=<durable-folder>/data npm start
```

Keep the folder: the app clones from `<durable-folder>/out/origin`. In the Analyses tab (CORE) paste the contents of `DEMO-101.md`, or only the key `DEMO-101` and the text as notes. Save the final report to a file and score it:

```
node test/fixtures/pseudo-repo/score.js report.txt
```

The score lists which defects were found, which were missed and whether the agent wrongly blamed the correct validator. Exit code 1 means a missed defect.

## Without the app

`node test/pseudo-repo.test.js` (part of `npm test`) builds the repos and checks that `qa-git.sh prepare`, `find` and `refs` see the change and the consumer.
