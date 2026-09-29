import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import type { AuthStatus, User } from '../api/types';
import { useAuth } from '../lib/auth';
import { Button, Input, errorMessage } from '../components/ui';

export function Login({ status }: { status: AuthStatus }) {
  const { signedIn } = useAuth();
  const setup = !status.hasUser && status.registrationOpen;
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const r = await api.post<{ user: User; csrfToken: string; aiAvailable: boolean }>(setup ? '/auth/setup' : '/auth/login', setup ? f : { email: f.email, password: f.password });
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
            {setup ? 'This is a single-user workspace. The first account created owns all data.' : 'Welcome back. Your job search is where you left it.'}
          </p>
          {!status.hasUser && !status.registrationOpen ? <p className="muted">Registration is disabled on this server.</p> : null}
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
            {error ? (
              <div className="error-box" role="alert">
                {error}
              </div>
            ) : null}
            <Button variant="primary" type="submit" loading={pending} style={{ height: 36 }}>
              {setup ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          <p className="small subtle row" style={{ marginTop: 16 }}>
            <ShieldCheck width={14} /> Session cookie is httpOnly; passwords are hashed with scrypt.
          </p>
        </div>
      </div>
    </div>
  );
}
