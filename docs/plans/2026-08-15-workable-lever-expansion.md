# Workable and Lever expansion plan

## Objective

Add public Saudi job discovery from configured Workable and Lever career sites, then route eligible roles through the existing trusted-source, scoring, queue, document, and reporting workflow. Neither source may enter automatic submission using an applicant-owned credential.

## Boundary

| Channel | Public discovery | Application route | Auto-submit policy |
| --- | --- | --- | --- |
| Workable | Public widget job data for an explicitly configured account slug | Use the employer’s public application URL | Review-only. Workable’s authenticated candidate API belongs to the hiring account. |
| Lever | Public postings API for an explicitly configured site slug | Use the public `applyUrl` | Review-only. Lever application POST requires an employer-generated API key. |

## Implementation slices

1. Extend source and application platform contracts with `workable` and `lever`, but extend the automation configuration validator so both channels can only use `review-only` capability.
2. Add deterministic public discovery adapters with Saudi location checks, target-title filtering, bounded concurrency, retry behavior, normalizers, and tests based on recorded API-shaped fixtures.
3. Extend trusted-source resolution, ingestion normalization, and the daily operation so configured Workable and Lever slugs are fetched and assessed together with Greenhouse boards.
4. Expose optional direct discovery commands, document private configuration, and run the full test suite plus a queue-only live smoke test.

## Acceptance tests

- A configured official Workable or Lever slug with a Saudi listing reaches the trusted-source layer.
- An unconfigured slug, stale role, duplicate role, or non-Saudi listing is excluded.
- A Workable or Lever role may be queued and tailored, but its application stage returns review-needed and creates no remote submission request.
- The daily run processes configured Greenhouse, Workable, and Lever sources in one idempotent cycle.
- Full test suite passes and no private configuration or credentials are committed.
