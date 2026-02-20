"use client";

import React from "react";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedLayout from "@/components/auth/ProtectedLayout";

export default function ClientProviders({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <AuthProvider>
            <ProtectedLayout>{children}</ProtectedLayout>
        </AuthProvider>
    );
}
