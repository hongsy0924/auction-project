import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

// In production, store this securely in environment variables
const JWT_SECRET = 'your-secret-key';

// In production, use a real database
const VALID_USERS = [
    {
        username: 'guamm1',
        password: '1729hsj!',
        name: '관리자',
        role: 'admin',
    },
];

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { username, password } = body;

        // Validate input
        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username and password are required' }, 
                { status: 400 }
            );
        }

        // Find user
        const user = VALID_USERS.find(u =>
            u.username === username && u.password === password
        );

        if (!user) {
            return NextResponse.json(
                { error: 'Invalid credentials' }, 
                { status: 401 });
        }
        

        // Create token
        const token = jwt.sign(
            {
                username: user.username,
                name: user.name,
                role: user.role,
            },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Create response
        const response = NextResponse.json({
            user: {
                username: user.username,
                role: user.role,
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
            { status: 500 });
    }
}
    
