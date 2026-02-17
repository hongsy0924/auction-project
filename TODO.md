# TODO — Future Improvements

## Naming & Structure Cleanup

> Saved from v2/refactor review (2026-02-17). Do this on a separate branch when ready.

### Quick Wins (low risk)

- [ ] `court_auction_crawler.py` → `main.py` — clearer entry point name
- [ ] `browser_fetcher.py` → `browser.py` — role is implied by package context
- [ ] Delete `deploy.sh` and `run-crawler.sh` — `Makefile` already covers both

### Bigger Renames (update Dockerfile, fly.toml, Makefile)

- [ ] `auction-crawler/` → `crawler/` — drop redundant prefix
- [ ] `auction-viewer/` → `web/` — shorter, standard monorepo naming
- [ ] `auction-viewer/database/` → `web/data/` — shorter

### Principles to Follow

1. **No prefix duplication** — inside `auction-project`, everything is already "auction"
2. **Name by role** — `browser.py` not `browser_fetcher.py`
3. **Short but unambiguous** — `web/` > `auction-viewer/`
4. **One way to do things** — Makefile only, no duplicate shell scripts

### Files That Will Need Updates After Rename

- `Makefile` (all `cd auction-crawler` / `cd auction-viewer` paths)
- `fly.toml`
- `Dockerfile`
- `.gitignore`
- `.github/workflows/*.yml`
- `run-crawler.sh` / `deploy.sh` (if not deleted first)
- `src/settings.py` (`database_dir` default path)
