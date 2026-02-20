import React, { useState } from "react";
import styles from "./LoginForm.module.css";

interface LoginFormProps {
  onLogin: (username: string, password: string) => Promise<void>;
  error?: string;
}

export default function LoginForm({ onLogin, error }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onLogin(username, password);
    } catch {
      // 로그인 실패는 parent에서 error prop으로 처리
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>경매물건 로그인</h2>

      <form onSubmit={handleSubmit}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.fieldGroup}>
          <label htmlFor="username" className={styles.label}>
            아이디
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className={styles.input}
          />
        </div>

        <div className={styles.fieldGroupLast}>
          <label htmlFor="password" className={styles.label}>
            비밀번호
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={styles.input}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={styles.submitButton}
        >
          {isLoading ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
