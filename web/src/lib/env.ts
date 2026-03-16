/**
 * Validate required environment variables at import time.
 * Import this in layout.tsx so it runs on server startup.
 */

interface EnvCheck {
    name: string;
    required: boolean;
    description: string;
}

const ENV_CHECKS: EnvCheck[] = [
    { name: "JWT_SECRET", required: true, description: "JWT signing secret for auth" },
    { name: "VALID_USERS", required: false, description: "JSON array of user credentials (primary auth)" },
    { name: "ADMIN_USERNAME", required: false, description: "Admin login username (legacy fallback)" },
    { name: "ADMIN_PASSWORD_HASH", required: false, description: "Admin login password hash (legacy fallback)" },
    { name: "DATABASE_PATH", required: false, description: "Path to auction_data.db (defaults to ./database/)" },
    { name: "CLIK_API_KEY", required: false, description: "CLIK council minutes API key" },
    { name: "GEMINI_API_KEY", required: false, description: "Gemini LLM API key" },
    { name: "LURIS_API_KEY", required: false, description: "LURIS urban planning API key" },
    { name: "EUM_API_ID", required: false, description: "EUM API ID" },
    { name: "EUM_API_KEY", required: false, description: "EUM API key" },
    { name: "PRECOMPUTE_SECRET", required: false, description: "Bearer token for precompute endpoint" },
];

const missing: string[] = [];
const warnings: string[] = [];

for (const check of ENV_CHECKS) {
    const value = process.env[check.name];
    if (!value) {
        if (check.required) {
            missing.push(`  - ${check.name}: ${check.description}`);
        } else {
            warnings.push(`  - ${check.name}: ${check.description}`);
        }
    }
}

if (warnings.length > 0) {
    console.warn(`[ENV] Optional variables not set (some features will be disabled):\n${warnings.join("\n")}`);
}

// At least one auth method must be configured
const hasAuth = process.env.VALID_USERS || (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH);
if (!hasAuth) {
    missing.push("  - Auth: set VALID_USERS or both ADMIN_USERNAME + ADMIN_PASSWORD_HASH");
}

if (missing.length > 0) {
    console.error(`[ENV] FATAL: Required environment variables missing:\n${missing.join("\n")}`);
    if (process.env.NODE_ENV === "production") {
        throw new Error(`Missing required env vars: ${missing.map(m => m.split(":")[0].trim().replace("- ", "")).join(", ")}`);
    }
}
