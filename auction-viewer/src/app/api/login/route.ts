import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// JWT secret from environment variable (required)
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set');
}

// Admin credentials from environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const ADMIN_NAME = process.env.ADMIN_NAME || '관리자';

/**
 * Simple SHA-256 password verification.
 * To generate a hash: echo -n "your-password" | shasum -a 256
 */
function verifyPassword(inputPassword: string, storedHash: string): boolean {
    const inputHash = crypto.createHash('sha256').update(inputPassword).digest('hex');
    return crypto.timingSafeEqual(
        Buffer.from(inputHash, 'hex'),
        Buffer.from(storedHash, 'hex')
    );
}

export async function POST(request: NextRequest) {
    try {
        if (!JWT_SECRET) {
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 500 }
            );
        }

        const body = await request.json();
        const { username, password } = body;

        // Validate input
        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username and password are required' },
                { status: 400 }
            );
        }

        // Verify credentials
        const isValidUser = username === ADMIN_USERNAME
            && ADMIN_PASSWORD_HASH
            && verifyPassword(password, ADMIN_PASSWORD_HASH);

        if (!isValidUser) {
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        // Create token
        const token = jwt.sign(
            {
                username: ADMIN_USERNAME,
                name: ADMIN_NAME,
                role: 'admin',
            },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Create response
        const response = NextResponse.json({
            user: {
                username: ADMIN_USERNAME,
                role: 'admin',
            }
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
            { status: 500 }
        );
    }
}
