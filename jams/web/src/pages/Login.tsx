import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import type { AuthStatus, User } from '../api/types';
import { useAuth } from '../lib/auth';
import { Button, Input, errorMessage } from '../components/ui';

export function Login({ status }: { status: AuthStatus }) {
  const { signedIn } = useAuth();
  const canRegister = !!status.registrationOpen;
  // Default to registration on a fresh instance; otherwise to sign-in.
  const [mode, setMode] = useState<'signin' | 'register'>(canRegister && !status.hasUser ? 'register' : 'signin');
  const setup = canRegister && mode === 'register';
  const switchMode = (m: 'signin' | 'register') => {
    setMode(m);
    setError(null);
  };
  const [f, setF] = useState({ name: '', email: '', password: '', setupToken: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const r = await api.post<{ user: User; csrfToken: string; aiAvailable: boolean }>(setup ? '/auth/register' : '/auth/login', setup ? f : { email: f.email, password: f.password });
      signedIn(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ width: 'min(400px, 100%)' }}>
        <div className="card-body" style={{ padding: 28 }}>
          <div className="brand" style={{ padding: 0, marginBottom: 20 }}>
            <div className="brand-mark">J</div>
            <span>
              JAMS
              <small>Job search command center</small>
            </span>
          </div>
          <h1 style={{ fontSize: 20 }}>{setup ? 'Create your account' : 'Sign in'}</h1>
          <p className="muted" style={{ margin: '4px 0 18px' }}>
            {setup ? 'Your account gets its own private workspace. No one else can see your data.' : 'Welcome back. Your job search is where you left it.'}
          </p>
          {status.unavailable ? (
            <div className="error-box" role="alert" style={{ marginBottom: 14 }}>
              {status.unavailable}
            </div>
          ) : null}
          {!status.hasUser && !canRegister ? <p className="muted">Registration is disabled on this server.</p> : null}
          <form className="stack" onSubmit={submit}>
            {setup ? <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="name" /> : null}
            <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" autoFocus />
            <Input
              label="Password"
              type="password"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              required
              minLength={setup ? 10 : 1}
              autoComplete={setup ? 'new-password' : 'current-password'}
              help={setup ? 'At least 10 characters.' : undefined}
            />
            {setup && status.setupTokenRequired ? (
              <Input
                label="Invite code"
                type="password"
                value={f.setupToken}
                onChange={(e) => setF({ ...f, setupToken: e.target.value })}
                required
                autoComplete="off"
                help="Ask the server owner. It keeps strangers from creating accounts here."
              />
            ) : null}
            {error ? (
              <div className="error-box" role="alert">
                {error}
              </div>
            ) : null}
            <Button variant="primary" type="submit" loading={pending} style={{ height: 36 }}>
              {setup ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          {canRegister ? (
            <p className="small muted" style={{ marginTop: 14, textAlign: 'center' }}>
              {setup ? 'Already have an account? ' : 'New here? '}
              <button type="button" className="link-button" onClick={() => switchMode(setup ? 'signin' : 'register')}>
                {setup ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          ) : null}
          <p className="small subtle row" style={{ marginTop: 16 }}>
            <ShieldCheck width={14} /> Session cookie is httpOnly; passwords are hashed with scrypt.
          </p>
        </div>
      </div>
    </div>
  );
}
