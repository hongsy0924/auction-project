import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // Get the pathname
    const path = request.nextUrl.pathname;

    // Define public paths that don't require authentication
    const isPublicPath = path === '/api/login';

    // Check if path is an API route (except for login)
    const isApiPath = path.startsWith('/api/') && !isPublicPath;

    if (isApiPath) {
        // Check for authentication token in the request header
        const authToken = request.cookies.get('authToken')?.value;
        if (!authToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: '/api/:path*',
};
    