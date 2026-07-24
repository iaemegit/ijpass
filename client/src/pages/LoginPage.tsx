import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { api, saveSession, type PortalUser } from '../lib/auth';

const roles = [
  { id: 'SUPER_ADMIN', label: 'Super Admin', icon: 'bi-shield-lock', description: 'Complete platform, user, and data administration.' },
  { id: 'INTERNAL_USER', label: 'Internal User', icon: 'bi-person-workspace', description: 'Limited access for authorized data-entry staff.' },
  { id: 'PUBLISHER', label: 'Publisher', icon: 'bi-journals', description: 'Limited access for registered publishing organizations.' }
] as const;

const loginSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'INTERNAL_USER', 'PUBLISHER']),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must contain at least 8 characters'),
  remember: z.boolean().optional()
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage({ portal = 'staff' }: { portal?: 'staff' | 'publishers' }) {
  const availableRoles = portal === 'staff' ? roles.filter(role => role.id !== 'PUBLISHER') : roles.filter(role => role.id === 'PUBLISHER');
  const isPublisherPortal = portal === 'publishers';
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [loginError, setLoginError] = useState('');
  const navigate = useNavigate();
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { role: portal === 'staff' ? 'INTERNAL_USER' : 'PUBLISHER', email: '', password: '', remember: false }
  });
  useEffect(() => {
    reset({ role: portal === 'staff' ? 'INTERNAL_USER' : 'PUBLISHER', email: '', password: '', remember: false });
    setShowPassword(false); setLoginError(''); setMessage('');
  }, [portal, reset]);
  const selectedRole = watch('role');

  const onSubmit = async (values: LoginValues) => {
    setMessage(''); setLoginError('');
    try {
      const { data } = await api.post<{ token: string; user: PortalUser }>('/auth/login', values);
      saveSession(data.token, data.user, values.remember);
      navigate(data.user.role === 'PUBLISHER' ? '/publisher' : '/admin');
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const response = (error as { response?: { data?: { message?: string } } }).response;
        setLoginError(response?.data?.message || 'Unable to sign in. Please try again.');
      } else setLoginError('Unable to connect to the login service.');
    }
  };

  return <section className="login-page">
    <div className="container">
      <div className="login-shell">
        <div className="login-intro">
          <Link className="login-brand" to="/"><span className="brand-mark">IJ</span><span><strong>IJPAss</strong><small>Secure Access Portal</small></span></Link>
          <div className="login-intro-copy">
            <span className="eyebrow-light"><i className="bi bi-lock me-2"/>Protected workspace</span>
            <h1>{isPublisherPortal ? 'Publisher' : 'Data Entry'}<br/><em>Access Portal.</em></h1>
            <p>{isPublisherPortal ? 'A secure workspace for registered publishers to manage journal information, submissions, and association services.' : 'A protected workspace for authorized IJPAss administrators and internal data-entry users.'}</p>
            <ul><li><i className="bi bi-check-circle-fill"/>Role-based permissions</li><li><i className="bi bi-check-circle-fill"/>Protected account access</li><li><i className="bi bi-check-circle-fill"/>{isPublisherPortal ? 'Publisher and journal records' : 'Controlled data-entry operations'}</li></ul>
          </div>
          <p className="login-help">Need help? <Link to="/contact">Contact IJPAss support</Link></p>
        </div>
        <div className="login-form-panel">
          <div className="login-form-heading"><span className="eyebrow">{isPublisherPortal ? 'Publisher access' : 'Administration & data entry'}</span><h2>{isPublisherPortal ? 'Publisher sign in' : 'Internal portal sign in'}</h2><p>{isPublisherPortal ? 'Enter the credentials assigned to your publishing organization.' : 'Select your authorized access level and enter your credentials.'}</p></div>
          <form onSubmit={handleSubmit(onSubmit)} noValidate autoComplete="off">
            <label className="field-label">Choose access type</label>
            <div className="role-options">{availableRoles.map(role => <button type="button" key={role.id} className={`role-option ${selectedRole === role.id ? 'active' : ''}`} onClick={() => setValue('role', role.id, { shouldValidate: true })}><i className={`bi ${role.icon}`}/><span><b>{isPublisherPortal ? 'Publisher' : role.label}</b><small>{isPublisherPortal ? 'Limited access for registered publishing organizations.' : role.description}</small></span><i className="bi bi-check-circle-fill selected-check"/></button>)}</div>
            <input type="hidden" {...register('role')}/>
            <div className="mb-3"><label className="field-label" htmlFor="login-email">Email address</label><div className="input-icon"><i className="bi bi-envelope"/><input id="login-email" type="email" autoComplete="off" data-lpignore="true" data-1p-ignore placeholder="name@organization.com" className={`form-control ${errors.email ? 'is-invalid' : ''}`} {...register('email')}/></div>{errors.email && <div className="field-error">{errors.email.message}</div>}</div>
            <div className="mb-2"><div className="d-flex justify-content-between"><label className="field-label" htmlFor="login-password">Password</label><a className="forgot-link" href="mailto:info@ijpass.com?subject=Password reset request">Forgot password?</a></div><div className="input-icon"><i className="bi bi-key"/><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" data-lpignore="true" data-1p-ignore placeholder="Enter your password" className={`form-control ${errors.password ? 'is-invalid' : ''}`} {...register('password')}/><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}><i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}/></button></div>{errors.password && <div className="field-error">{errors.password.message}</div>}</div>
            <div className="form-check login-remember"><input className="form-check-input" id="remember" type="checkbox" {...register('remember')}/><label className="form-check-label" htmlFor="remember">Keep me signed in on this device</label></div>
            {message && <div className="alert alert-info login-message"><i className="bi bi-info-circle me-2"/>{message}</div>}
            {loginError && <div className="alert alert-danger login-message"><i className="bi bi-exclamation-circle me-2"/>{loginError}</div>}
            <button className="btn btn-primary login-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : `Continue as ${isPublisherPortal ? 'Publisher' : roles.find(role => role.id === selectedRole)?.label}`}<i className="bi bi-arrow-right ms-2"/></button>
          </form>
          <div className="login-security"><i className="bi bi-shield-check"/><span>Your access is protected. Never share your login credentials with anyone.</span></div>
        </div>
      </div>
    </div>
  </section>;
}
