# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/cldixon/edro/security/advisories/new)
rather than in a public issue. You should get a response within a week.

If you accidentally find credentials or data from a real Foundry instance in this repository,
report it the same way so it can be removed from history.

## What edro sends where

edro only talks to the Foundry host you configure. It has no telemetry and sends no data to any
other service. Credentials are stored in your OS keychain (or read from environment variables) and
are never written to the repository or printed in logs.

edro is an unofficial community project and is not affiliated with or endorsed by Palantir.
