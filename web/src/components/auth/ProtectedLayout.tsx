import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import LoginForm from "@/components/auth/LoginForm";
import styles from "./ProtectedLayout.module.css";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, login, logout } = useAuth();
  const [error, setError] = useState<string | undefined>();

  const handleLogin = async (username: string, password: string) => {
    setError(undefined);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    }
  };

  if (loading) {
    return <div className={styles.loadingContainer}>로딩 중...</div>;
  }

  if (!user) {
    return <LoginForm onLogin={handleLogin} error={error} />;
  }

  return (
    <div>
      <header className={styles.header}>
        <h2 className={styles.headerTitle}>관리시스템</h2>
        <div className={styles.headerRight}>
          <span className={styles.username}>{user.username}님</span>
          <button onClick={logout} className={styles.logoutButton}>
            로그아웃
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}