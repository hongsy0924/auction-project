# AGENTS.md - Critical Project Knowledge

This document contains critical information for future agents and developers working on this project. Please read this before making significant changes to the environment or configuration.

## Critical Issues & Fixes (2026-02-16)

### 1. Node.js v25+ Compatibility Issue (500 Internal Server Error)
**Symptom:**
-   Application crashes with `500 Internal Server Error` on every request.
-   Error log shows: `TypeError: localStorage.getItem is not a function`.
-   Warning: `--localstorage-file was provided without a valid path`.

**Cause:**
-   Node.js v25 introduced an experimental native `localStorage` implementation.
-   This implementation conflicts with Next.js App Router's server-side rendering environment, causing collisions with the `global.localStorage` object.

**Solution:**
-   We patched `next.config.ts` to explicitly delete `global.localStorage` if it exists.
-   **DO NOT REMOVE** this patch unless Next.js or Node.js resolves this upstream.

```typescript
// Located in next.config.ts > webpack function
if (typeof global.localStorage !== "undefined") {
  try {
    Object.defineProperty(global, "localStorage", {
      value: undefined,
      writable: true,
    });
  } catch (e) {
    console.error("Failed to patch localStorage:", e);
  }
}
```

### 2. SQLite Infinite Compilation Loop
**Symptom:**
-   `npm run dev` enters an infinite loop showing "Compiling..." repeatedly.
-   Browser hangs or constantly reloads.

**Cause:**
-   SQLite updates its Write-Ahead Log (WAL) files (`.db-wal`, `.db-shm`) in the project directory whenever the database is accessed (even for reads).
-   Next.js's file watcher detects these changes and triggers a full rebuild.
-   The rebuild reloads the app -> app queries DB -> DB updates WAL -> Watcher triggers rebuild (Infinite Loop).

**Solution:**
-   We configured `next.config.ts` to strictly **ignore** the `database` directory using absolute paths.
-   **DO NOT** move the database file without updating these ignore patterns.

```typescript
// Located in next.config.ts > webpack function
if (dev) {
  const dbPath = path.join(__dirname, "database");
  config.watchOptions = {
    ...config.watchOptions,
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      dbPath,               // Absolute path to database dir
      path.join(dbPath, "**/*"), // All files inside
    ],
  };
}
```

### 3. Native Module Bundling (`sqlite3`)
**Symptom:**
-   Build errors or runtime errors about missing bindings for `sqlite3`.

**Solution:**
-   Added `serverExternalPackages: ["sqlite3"]` in `next.config.ts`.
-   This prevents Next.js from trying to bundle the native C++ module, letting Node.js require it at runtime.

---

## Best Practices
-   **Database**: Always use the singleton pattern for `sqlite3` connections in development to prevent connection leaks and file locking errors. See `src/lib/db.ts`.
-   **Environment**: If you encounter strange `TypeError`s with standard web APIs (like localStorage, sessionStorage, WebSocket) on the server, check the Node.js version compatibility first.

### Data Update Workflow
To update the data displayed in the frontend:
1.  **Run Crawler**:
    ```bash
    cd auction-crawler
    # python3 court_auction_crawler.py  <-- Currently facing 400 Bad Request (Blocked)
    # Use insert_test_data.py for testing:
    python3 insert_test_data.py
    ```
    This fetches new data into the `auction_list` table of `auction_data.db`.

2.  **Clean Data**:
    ```bash
    python3 sqlite_cleaning.py
    ```
    This transforms `auction_list` into `auction_list_cleaned` (with Korean columns) which the frontend reads.

3.  **Frontend**:
    The Next.js app will automatically show the new data on refresh (no restart needed).
