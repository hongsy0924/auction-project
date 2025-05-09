import React, { useState } from "react";

interface LoginFormProps {
    onLogin: (username: string, password: string) => Promise<void>;
    errorMessage?: string;
}

export default function LoginForm({ onLogin, errorMessage }: LoginFormProps) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
         await onLogin(username, password);
        } catch (err) {
            // 로그인 실패 처리 (parent component에서 처리)
        } finally {
            setIsLoading(false);
        }
    };
    

    return (
        <div style={{ maxWidth: "400px", margin: "100px auto", padding: "20px", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
          <h2 style={{ textAlign: "center", marginBottom: "24px" }}>경매물건 로그인</h2>
          
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{ padding: "10px", marginBottom: "15px", backgroundColor: "#ffebee", color: "#c62828", borderRadius: "4px" }}>
                {error}
              </div>
            )}
            
            <div style={{ marginBottom: "16px" }}>
              <label htmlFor="username" style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}>아이디</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                style={{ width: "100%", padding: "10px", borderRadius: "4px", border: "1px solid #ddd" }}
              />
            </div>
            
            <div style={{ marginBottom: "24px" }}>
              <label htmlFor="password" style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}>비밀번호</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: "100%", padding: "10px", borderRadius: "4px", border: "1px solid #ddd" }}
              />
            </div>
            
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#0070f3",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.7 : 1
              }}
            >
              {isLoading ? "로그인 중..." : "로그인"}
            </button>
          </form>
        </div>
      );
    }
