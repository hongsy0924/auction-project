# TODO — Future Improvements

## Naming & Structure Cleanup

> Saved from v2/refactor review (2026-02-17). Do this on a separate branch when ready.

### Remaining

- [ ] `auction-viewer/database/` → `web/data/` — shorter

### Principles to Follow

1. **No prefix duplication** — inside `auction-project`, everything is already "auction"
2. **Name by role** — use clear, role-based names
3. **Short but unambiguous** — `web/` > `auction-viewer/`
4. **One way to do things** — Makefile only, no duplicate shell scripts
