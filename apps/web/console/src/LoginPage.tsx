import { FormEvent, useState } from "react";

type Props = {
  initialBaseUrl: string;
  initialToken: string;
  loading: boolean;
  errorMessage: string | null;
  onSubmit: (baseUrl: string, token: string) => Promise<void>;
};

export function LoginPage({
  initialBaseUrl,
  initialToken,
  loading,
  errorMessage,
  onSubmit,
}: Props) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState(initialToken);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedToken = token.trim();
    if (!trimmedBaseUrl) {
      setLocalError("请输入 Base URL。");
      return;
    }
    if (!trimmedToken) {
      setLocalError("请输入 Bearer Token。");
      return;
    }
    setLocalError(null);
    await onSubmit(trimmedBaseUrl, trimmedToken);
  };

  return (
    <main className="login-page">
      <section className="login-stage">
        <article className="login-brand-panel">
          <span className="hero-chip hero-chip-soft">G.A.A.</span>
          <h1>Girl-Ai-Agent 控制台</h1>
          <p>统一管理提供商、模型、智能体和多会话聊天，网页端与桌面端共用同一套界面。</p>
          <div className="login-feature-list">
            <article className="login-feature-card">
              <strong>统一舞台</strong>
              <span>同一套页面同时覆盖网页端和桌面端。</span>
            </article>
            <article className="login-feature-card">
              <strong>多角色工作流</strong>
              <span>从配置模型到进入聊天工作台，整个流程都保持一致。</span>
            </article>
            <article className="login-feature-card">
              <strong>高密度但不压迫</strong>
              <span>保留操作效率，同时把层次、留白和识别度做得更舒服。</span>
            </article>
          </div>
        </article>

        <section className="login-card">
          <header className="login-card-header">
            <p className="login-eyebrow">安全接入</p>
            <h2>连接无头服务</h2>
            <p>请输入无头服务地址与访问 Token 后继续。</p>
          </header>
          <form className="stack" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              Base URL
              <input
                autoComplete="url"
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:8787"
                value={baseUrl}
              />
            </label>
            <label>
              Bearer Token
              <input
                autoComplete="current-password"
                onChange={(event) => setToken(event.target.value)}
                placeholder="输入 GIRL_AI_AGENT_TOKEN"
                type="password"
                value={token}
              />
            </label>
            {(localError || errorMessage) && (
              <div className="error-box">
                <strong>登录失败</strong>
                <div>{localError ?? errorMessage}</div>
              </div>
            )}
            <button className="primary" disabled={loading} type="submit">
              {loading ? "登录中..." : "登录并进入工作台"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

