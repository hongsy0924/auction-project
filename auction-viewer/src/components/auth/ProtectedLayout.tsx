import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import LoginForm from '@/components/auth/LoginForm';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
    const { user, loading, login } = useAuth();
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
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>로딩 중...</div>;
      }
      if (!user) {
        return <LoginForm onLogin={handleLogin} error={error} />;
      }
    
      return (
        <div>
          <header style={{ 
            padding: '12px 20px', 
            backgroundColor: '#f8f9fa', 
            borderBottom: '1px solid #e9ecef',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h2 style={{ margin: 0 }}>경매물건 관리시스템</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>{user.username}님</span>
              <button 
                onClick={() => { const { logout } = useAuth(); logout(); }}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#f1f3f5',
                  border: '1px solid #ced4da',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                로그아웃
              </button>
            </div>
          </header>
          <main>{children}</main>
        </div>
      );
    }