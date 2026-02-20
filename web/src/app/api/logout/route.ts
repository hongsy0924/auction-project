import { NextResponse } from "next/server";

export async function POST() {
    const response = NextResponse.json({ success: true });

    response.cookies.set({
        name: 'authToken',
        value: '',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 0,
    });

    return response;
    
}