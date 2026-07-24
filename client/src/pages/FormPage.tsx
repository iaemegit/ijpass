import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../lib/auth';
import { countries } from '../data/countries';
import Recaptcha from '../components/Recaptcha';

const schema = z.object({
  name: z.string().min(2, 'Please enter your name'),
  email: z.string().email('Enter a valid email'),
  organization: z.string().min(2, 'Please enter your organization'),
  country: z.string().min(1, 'Please select your country'),
  message: z.string().min(10, 'Please provide a little more detail')
});
type Values = z.infer<typeof schema>;

export default function FormPage({ kind = 'Contact' }: { kind?: string }) {
  const [confirmation, setConfirmation] = useState<{ reference?: string; mailSent?: boolean } | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [recaptchaKey, setRecaptchaKey] = useState(0);
  const isContact = kind === 'Contact us' || kind === 'Contact';
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema), defaultValues: { country: '' }
  });
  const handleRecaptcha = useCallback((token: string) => setRecaptchaToken(token), []);

  const submit = async (values: Values) => {
    setSubmitError('');
    try {
      if (isContact) {
        if (!recaptchaToken) {
          setSubmitError('Please confirm that you are not a robot.');
          return;
        }
        const { data } = await api.post<{ reference: string; emailQueued: boolean }>('/contact', { ...values, recaptchaToken });
        setConfirmation({ reference: data.reference, mailSent: data.emailQueued });
        reset({ name: '', email: '', organization: '', country: '', message: '' });
        setRecaptchaToken('');
        setRecaptchaKey(key => key + 1);
      } else {
        await new Promise(resolve => setTimeout(resolve, 500));
        setConfirmation({});
        reset();
      }
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      setSubmitError(message || 'We could not submit your enquiry. Please try again or email editor.ijpass@gmail.com.');
      setRecaptchaToken('');
      setRecaptchaKey(key => key + 1);
    }
  };

  return <>
    <section className="page-hero"><div className="container"><span className="eyebrow-light">Connect with IJPAss</span><h1>{kind}</h1><p>Tell us how we can support your publishing journey. Our team will respond as soon as possible.</p></div></section>
    <section className="section-space"><div className="container"><div className="row g-5">
      <div className="col-lg-5"><span className="eyebrow">Get in touch</span><h2>Let’s start a <span>conversation.</span></h2><p className="lead-copy">Whether you have a question about membership, journal ranking, or publishing standards, we’re here to help.</p><div className="contact-item"><i className="bi bi-envelope"/><div><b>Email</b><span>editor.ijpass@gmail.com</span></div></div><div className="contact-item"><i className="bi bi-globe"/><div><b>Website</b><span>www.ijpass.com</span></div></div></div>
      <div className="col-lg-6 offset-lg-1"><div className="form-card"><form onSubmit={handleSubmit(submit)} noValidate><h3 className="mb-4">{kind}</h3><div className="row g-3">
        <div className="col-md-6"><label>Full name</label><input className={`form-control ${errors.name ? 'is-invalid' : ''}`} {...register('name')}/><div className="invalid-feedback">{errors.name?.message}</div></div>
        <div className="col-md-6"><label>Email address</label><input className={`form-control ${errors.email ? 'is-invalid' : ''}`} {...register('email')}/><div className="invalid-feedback">{errors.email?.message}</div></div>
        <div className="col-md-6"><label>Organization</label><input className={`form-control ${errors.organization ? 'is-invalid' : ''}`} {...register('organization')}/><div className="invalid-feedback">{errors.organization?.message}</div></div>
        {isContact && <div className="col-md-6"><label>Country</label><select className={`form-select ${errors.country ? 'is-invalid' : ''}`} {...register('country')}><option value="">Select your country</option>{countries.map(country => <option value={country} key={country}>{country}</option>)}</select><div className="invalid-feedback">{errors.country?.message}</div></div>}
        <div className="col-12"><label>How can we help?</label><textarea rows={5} className={`form-control ${errors.message ? 'is-invalid' : ''}`} {...register('message')}/><div className="invalid-feedback">{errors.message?.message}</div></div>
        {isContact && <div className="col-12"><Recaptcha key={recaptchaKey} onChange={handleRecaptcha}/></div>}
        {submitError && <div className="col-12"><div className="alert alert-danger mb-0">{submitError}</div></div>}
        <div className="col-12"><button className="btn btn-primary w-100" disabled={isSubmitting}>{isSubmitting ? 'Sending…' : 'Submit enquiry'} <i className="bi bi-arrow-right ms-2"/></button></div>
      </div></form></div></div>
    </div></div></section>
    {confirmation && <div className="confirmation-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmation-title"><div className="confirmation-popup"><button className="confirmation-close" onClick={() => setConfirmation(null)} aria-label="Close"><i className="bi bi-x-lg"/></button><div className="confirmation-icon"><i className="bi bi-check-lg"/></div><span className="eyebrow">Submission successful</span><h2 id="confirmation-title">Thank you for contacting IJPAss!</h2><p>Your enquiry has been received successfully. Our team will review it and respond as soon as possible.</p>{confirmation.reference && <div className="confirmation-reference"><small>Enquiry reference</small><strong>{confirmation.reference}</strong></div>}{confirmation.mailSent && <p className="confirmation-mail"><i className="bi bi-envelope-check me-2"/>Your confirmation email is being sent.</p>}<button className="btn btn-primary" onClick={() => setConfirmation(null)}>Done</button></div></div>}
  </>;
}
