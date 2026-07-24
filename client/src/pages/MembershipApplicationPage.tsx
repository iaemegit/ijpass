import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { api } from '../lib/auth';
import { countries } from '../data/countries';
import Recaptcha from '../components/Recaptcha';

const photoTypes = ['image/jpeg', 'image/png', 'image/webp'];
const resumeTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const schema = z.object({
  name: z.string().min(2, 'Please enter your full name'),
  email: z.string().email('Enter a valid email ID'),
  phone: z.string().trim().min(7, 'Enter a valid phone number').max(30, 'Enter a valid phone number'),
  affiliation: z.string().min(2, 'Please enter your affiliation'),
  country: z.string().min(1, 'Please select your country'),
  membershipCategoryId: z.string().min(1, 'Please select a membership category'),
  message: z.string().min(10, 'Please provide a little more detail'),
  photo: z.any().refine(value => value instanceof FileList && value.length === 1, 'Please upload your photo').refine(value => !(value instanceof FileList) || !value[0] || photoTypes.includes(value[0].type), 'Upload a JPG, PNG, or WebP photo').refine(value => !(value instanceof FileList) || !value[0] || value[0].size <= 2 * 1024 * 1024, 'Photo must be 2 MB or smaller'),
  resume: z.any().refine(value => value instanceof FileList && value.length === 1, 'Please upload your Resume').refine(value => !(value instanceof FileList) || !value[0] || resumeTypes.includes(value[0].type), 'Upload a PDF, DOC, or DOCX Resume').refine(value => !(value instanceof FileList) || !value[0] || value[0].size <= 5 * 1024 * 1024, 'Resume must be 5 MB or smaller')
});
type Values = z.infer<typeof schema>;
type Category = { id: number; name: string };
const emptyValues = { name: '', email: '', phone: '', affiliation: '', country: '', membershipCategoryId: '', message: '' };

export default function MembershipApplicationPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [confirmation, setConfirmation] = useState<{ reference: string } | null>(null);
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [recaptchaKey, setRecaptchaKey] = useState(0);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: emptyValues });

  useEffect(() => {
    api.get<{ categories: Category[] }>('/membership-categories')
      .then(({ data }) => setCategories(data.categories))
      .catch(() => setCategoryError('Membership categories could not be loaded. Please refresh the page.'));
  }, []);
  const handleRecaptcha = useCallback((token: string) => setRecaptchaToken(token), []);

  const submit = async (values: Values) => {
    setSubmitError('');
    if (!recaptchaToken) { setSubmitError('Please confirm that you are not a robot.'); return; }
    const formData = new FormData();
    formData.append('name', values.name);
    formData.append('email', values.email);
    formData.append('phone', values.phone);
    formData.append('affiliation', values.affiliation);
    formData.append('country', values.country);
    formData.append('membershipCategoryId', values.membershipCategoryId);
    formData.append('message', values.message);
    formData.append('recaptchaToken', recaptchaToken);
    formData.append('photo', values.photo[0]);
    formData.append('resume', values.resume[0]);
    try {
      const { data } = await api.post<{ reference: string }>('/membership-applications', formData);
      setConfirmation({ reference: data.reference });
      reset(emptyValues);
      setRecaptchaToken('');
      setRecaptchaKey(key => key + 1);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      setSubmitError(message || 'We could not submit your membership application. Please try again.');
      setRecaptchaToken('');
      setRecaptchaKey(key => key + 1);
    }
  };

  return <>
    <section className="page-hero"><div className="container"><div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/><Link to="/membership">Membership</Link><i className="bi bi-chevron-right"/><span>Apply for Membership</span></div><span className="eyebrow-light">Join IJPAss</span><h1>Apply for Membership</h1><p>Complete the application form to join a global community committed to excellence in scholarly publishing.</p></div></section>
    <section className="section-space membership-application-page"><div className="container"><div className="row g-4 align-items-start">
      <div className="col-lg-4"><div className="membership-application-intro"><span className="application-intro-icon"><i className="bi bi-person-vcard"/></span><span className="eyebrow">Membership application</span><h2>Become part of the <span>IJPAss community.</span></h2><p>Submit your professional details for review. Our team will evaluate your application and contact you regarding the next steps.</p><ul><li><i className="bi bi-check-circle"/>Choose the appropriate membership category</li><li><i className="bi bi-check-circle"/>Upload a recent professional photo</li><li><i className="bi bi-check-circle"/>Attach your current Resume</li></ul><div className="application-support"><i className="bi bi-envelope"/><div><small>Need assistance?</small><a href="mailto:editor.ijpass@gmail.com">editor.ijpass@gmail.com</a></div></div></div></div>
      <div className="col-lg-8"><div className="form-card membership-application-form"><form onSubmit={handleSubmit(submit)} noValidate encType="multipart/form-data"><div className="application-form-heading"><div><span className="eyebrow">Applicant information</span><h3>Membership Application Form</h3></div><i className="bi bi-shield-check"/></div><div className="row g-3">
        <div className="col-md-6"><label>Full name</label><input autoComplete="name" className={`form-control ${errors.name ? 'is-invalid' : ''}`} {...register('name')}/><div className="invalid-feedback">{errors.name?.message}</div></div>
        <div className="col-md-6"><label>Email ID</label><input type="email" autoComplete="email" className={`form-control ${errors.email ? 'is-invalid' : ''}`} {...register('email')}/><div className="invalid-feedback">{errors.email?.message}</div></div>
        <div className="col-md-6"><label>Phone number</label><input type="tel" autoComplete="tel" className={`form-control ${errors.phone ? 'is-invalid' : ''}`} placeholder="Include country code" {...register('phone')}/><div className="invalid-feedback">{errors.phone?.message}</div></div>
        <div className="col-md-6"><label>Affiliation</label><input autoComplete="organization" className={`form-control ${errors.affiliation ? 'is-invalid' : ''}`} placeholder="Institution or organization" {...register('affiliation')}/><div className="invalid-feedback">{errors.affiliation?.message}</div></div>
        <div className="col-md-6"><label>Country</label><select className={`form-select ${errors.country ? 'is-invalid' : ''}`} {...register('country')}><option value="">Select your country</option>{countries.map(country => <option value={country} key={country}>{country}</option>)}</select><div className="invalid-feedback">{errors.country?.message}</div></div>
        <div className="col-md-6"><label>Member category</label><select className={`form-select ${errors.membershipCategoryId ? 'is-invalid' : ''}`} disabled={!categories.length} {...register('membershipCategoryId')}><option value="">Select membership category</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select><div className="invalid-feedback">{errors.membershipCategoryId?.message}</div>{categoryError && <small className="text-danger">{categoryError}</small>}</div>
        <div className="col-md-6"><label>Upload photo</label><input type="file" accept="image/jpeg,image/png,image/webp" className={`form-control ${errors.photo ? 'is-invalid' : ''}`} {...register('photo')}/><div className="invalid-feedback">{String(errors.photo?.message || '')}</div><small className="text-muted">JPG, PNG, or WebP; maximum 2 MB.</small></div>
        <div className="col-md-6"><label>Upload Resume</label><input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className={`form-control ${errors.resume ? 'is-invalid' : ''}`} {...register('resume')}/><div className="invalid-feedback">{String(errors.resume?.message || '')}</div><small className="text-muted">PDF, DOC, or DOCX; maximum 5 MB.</small></div>
        <div className="col-12"><label>Message</label><textarea rows={5} className={`form-control ${errors.message ? 'is-invalid' : ''}`} placeholder="Tell us briefly about your membership interest" {...register('message')}/><div className="invalid-feedback">{errors.message?.message}</div></div>
        <div className="col-12"><Recaptcha key={recaptchaKey} onChange={handleRecaptcha}/></div>
        {submitError && <div className="col-12"><div className="alert alert-danger mb-0">{submitError}</div></div>}
        <div className="col-12"><button className="btn btn-primary w-100" disabled={isSubmitting || !categories.length}>{isSubmitting ? 'Submitting…' : 'Submit Membership Application'} <i className="bi bi-send ms-2"/></button></div>
      </div></form></div></div>
    </div></div></section>
    {confirmation && <div className="confirmation-backdrop" role="dialog" aria-modal="true" aria-labelledby="membership-confirmation-title"><div className="confirmation-popup"><button className="confirmation-close" onClick={() => setConfirmation(null)} aria-label="Close"><i className="bi bi-x-lg"/></button><div className="confirmation-icon"><i className="bi bi-check-lg"/></div><span className="eyebrow">Application submitted</span><h2 id="membership-confirmation-title">Thank you for applying!</h2><p>Your membership application has been stored successfully. The IJPAss team will review your information and contact you.</p><div className="confirmation-reference"><small>Application reference</small><strong>{confirmation.reference}</strong></div><button className="btn btn-primary" onClick={() => setConfirmation(null)}>Done</button></div></div>}
  </>;
}
