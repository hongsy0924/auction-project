import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// JWT secret from environment variable (required)
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set');
}

/**
 * User credential entry.
 */
interface UserEntry {
    username: string;
    passwordHash: string;
    name: string;
    role: string;
}

/**
 * Load valid users from environment.
 * Supports two formats:
 *   1. VALID_USERS — JSON array: [{"username":"admin","passwordHash":"...","name":"관리자","role":"admin"}, ...]
 *   2. Legacy single-user: ADMIN_USERNAME + ADMIN_PASSWORD_HASH + ADMIN_NAME
 */
function getValidUsers(): UserEntry[] {
    const usersJson = process.env.VALID_USERS;
    if (usersJson) {
        try {
            return JSON.parse(usersJson) as UserEntry[];
        } catch (e) {
            console.error('Failed to parse VALID_USERS env var:', e);
        }
    }

    // Fallback: legacy single-user env vars
    const username = process.env.ADMIN_USERNAME;
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    if (username && passwordHash) {
        return [{
            username,
            passwordHash,
            name: process.env.ADMIN_NAME || '관리자',
            role: 'admin',
        }];
    }

    return [];
}

/**
 * SHA-256 password verification with timing-safe comparison.
 * To generate a hash: python3 -c "import hashlib; print(hashlib.sha256(b'your-password').hexdigest())"
 */
function verifyPassword(inputPassword: string, storedHash: string): boolean {
    const inputHash = crypto.createHash('sha256').update(inputPassword).digest('hex');
    return crypto.timingSafeEqual(
        Buffer.from(inputHash, 'hex'),
        Buffer.from(storedHash, 'hex'),
    );
}

export async function POST(request: NextRequest) {
    try {
        if (!JWT_SECRET) {
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 500 },
            );
        }

        const body = await request.json();
        const { username, password } = body;

        // Validate input
        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username and password are required' },
                { status: 400 },
            );
        }

        // Find matching user
        const users = getValidUsers();
        const matchedUser = users.find(
            (u) => u.username === username && verifyPassword(password, u.passwordHash),
        );

        if (!matchedUser) {
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 },
            );
        }

        // Create token
        const token = jwt.sign(
            {
                username: matchedUser.username,
                name: matchedUser.name,
                role: matchedUser.role,
            },
            JWT_SECRET,
            { expiresIn: '8h' },
        );

        // Create response
        const response = NextResponse.json({
            user: {
                username: matchedUser.username,
                role: matchedUser.role,
            },
        });

        // Set cookie
        response.cookies.set({
            name: 'authToken',
            value: token,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 8 * 60 * 60, // 8 hours
        });

        return response;
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
}

