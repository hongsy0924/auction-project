import React, { createContext, useState, useContext, useEffect } from "react";

interface User {
    username: string;
    token: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (username: string, password: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
        setUser(JSON.parse(storedUser));
    }
    setLoading(false);
}, []);

const login = async (username: string, password: string) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (username === "testuser" && password === "password") {
                const userData: User = {
                    username: "testuser",
                    token: "mockToken",
                };
                setUser(userData);
                localStorage.setItem("user", JSON.stringify(userData));
                resolve(void 0);
            } else {
                reject(new Error("Invalid username or password"));
            }
        }, 500);
    });
};

const logout = () => {
    setUser(null);
    localStorage.removeItem("user");
};

return (
    <AuthContext.Provider value={{ user, loading, login: login as (username: string, password: string) => Promise<void>, logout }}>
        {children}
    </AuthContext.Provider>
);
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
