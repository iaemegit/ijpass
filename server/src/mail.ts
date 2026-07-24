import nodemailer from 'nodemailer';

type ContactEmail = { name: string; email: string; organization?: string; country?: string; message: string };

const escapeHtml = (value = '') => value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);

const mailConfig = () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    transport: nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user, pass } }),
    from: process.env.MAIL_FROM || `IJPAss <${user}>`,
    contactTo: process.env.CONTACT_TO || 'editor.ijpass@gmail.com'
  };
};

export async function sendContactEmails(contact: ContactEmail, recordId: number) {
  const config = mailConfig();
  if (!config) return { sent: false, reason: 'SMTP is not configured' };
  const reference = `ENQ-${String(recordId).padStart(6, '0')}`;
  const name = escapeHtml(contact.name);
  const organization = escapeHtml(contact.organization || 'Not provided');
  const country = escapeHtml(contact.country || 'Not provided');
  const message = escapeHtml(contact.message).replace(/\n/g, '<br/>');

  await Promise.all([
    config.transport.sendMail({
      from: config.from,
      to: contact.email,
      replyTo: config.contactTo,
      subject: `We received your IJPAss enquiry — ${reference}`,
      text: `Dear ${contact.name},\n\nThank you for contacting the International Journal Publishers Association (IJPAss). We have received your enquiry and our team will respond as soon as possible.\n\nReference: ${reference}\n\nYour message:\n${contact.message}\n\nRegards,\nIJPAss Editorial Office\neditor.ijpass@gmail.com`,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#163241"><div style="background:#071f34;color:#fff;padding:24px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:24px">IJPAss</h1><p style="margin:5px 0 0;color:#bcd0d8">International Journal Publishers Association</p></div><div style="border:1px solid #dfe8e5;border-top:0;padding:26px;border-radius:0 0 12px 12px"><h2 style="color:#0c7771">Thank you for contacting us</h2><p>Dear ${name},</p><p>We have received your enquiry. Our team will review your message and respond as soon as possible.</p><p><strong>Reference:</strong> ${reference}</p><div style="background:#f3f7f5;border-left:4px solid #41d3ad;padding:14px;margin:20px 0"><strong>Your message</strong><p style="margin-bottom:0">${message}</p></div><p>Regards,<br/><strong>IJPAss Editorial Office</strong><br/><a href="mailto:editor.ijpass@gmail.com">editor.ijpass@gmail.com</a></p></div></div>`
    }),
    config.transport.sendMail({
      from: config.from,
      to: config.contactTo,
      replyTo: contact.email,
      subject: `IJPASS New enquiry from ${contact.name} — ${reference}`,
      text: `New IJPAss website enquiry\n\nReference: ${reference}\nName: ${contact.name}\nEmail: ${contact.email}\nCompany: ${contact.organization || 'Not provided'}\nCountry: ${contact.country || 'Not provided'}\n\nMessage:\n${contact.message}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;color:#163241"><h2 style="color:#0c7771">New website enquiry</h2><table style="border-collapse:collapse;width:100%"><tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Reference</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${reference}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Name</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${name}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Email</strong></td><td style="padding:8px;border-bottom:1px solid #ddd"><a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Company</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${organization}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Country</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${country}</td></tr></table><div style="background:#f3f7f5;padding:16px;margin-top:18px"><strong>Message</strong><p>${message}</p></div><p><a href="mailto:${escapeHtml(contact.email)}?subject=Re:%20Your%20IJPAss%20enquiry%20${reference}">Reply to ${name}</a></p></div>`
    })
  ]);
  return { sent: true, reference };
}

export type MemberNotificationAction = 'created' | 'updated' | 'enabled' | 'disabled' | 'deleted';
export type MemberNotification = {
  fullName: string;
  email: string;
  category: string;
  affiliation?: string | null;
  country?: string | null;
  fieldOfExpertise?: string | null;
  researchPapersPublished: number;
};

export async function sendMemberNotification(member: MemberNotification, action: MemberNotificationAction) {
  const config = mailConfig();
  if (!config) return { sent: false, reason: 'SMTP is not configured' };

  const siteRoot = (process.env.PUBLIC_SITE_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  const slug = encodeURIComponent(member.fullName.trim().replace(/\s+/g, '_'));
  const membersUrl = `${siteRoot}/membership/members`;
  const profileUrl = `${membersUrl}/${slug}`;
  const content = {
    created: { subject: 'Welcome to the IJPAss Member Directory', heading: 'Your member profile has been created', intro: 'We are pleased to confirm that your details have been added to the International Journal Publishers Association member directory.', badge: 'PROFILE CREATED', accent: '#0c7771' },
    updated: { subject: 'Your IJPAss member profile was updated', heading: 'Your profile details have been updated', intro: 'This is confirmation that your IJPAss member information was modified successfully. The latest stored details are shown below.', badge: 'PROFILE UPDATED', accent: '#0c7771' },
    enabled: { subject: 'Your IJPAss member profile is now enabled', heading: 'Your profile is now visible', intro: 'Your IJPAss member profile has been enabled and is available in the public Members List.', badge: 'PROFILE ENABLED', accent: '#17835f' },
    disabled: { subject: 'Your IJPAss member profile has been disabled', heading: 'Your profile is temporarily hidden', intro: 'Your IJPAss member profile has been disabled. To enable it, contact the Editor in Chief at editor@ijpass.com or editor.ijpass@gmail.com.', badge: 'PROFILE DISABLED', accent: '#b7791f' },
    deleted: { subject: 'Your IJPAss member record has been deleted', heading: 'Your member profile has been removed', intro: 'This email confirms that your IJPAss member record was deleted. The former profile URL is included below for reference and is no longer publicly available.', badge: 'PROFILE DELETED', accent: '#b33a48' }
  }[action];

  const name = escapeHtml(member.fullName);
  const email = escapeHtml(member.email);
  const category = escapeHtml(member.category);
  const affiliation = escapeHtml(member.affiliation || 'Not provided');
  const country = escapeHtml(member.country || 'Not provided');
  const expertise = escapeHtml(member.fieldOfExpertise || 'Not provided');
  const safeMembersUrl = escapeHtml(membersUrl);
  const safeProfileUrl = escapeHtml(profileUrl);
  const availabilityNote = action === 'disabled' ? 'The profile URL will become available again when your profile is enabled.' : action === 'deleted' ? 'The profile URL is no longer active because the record has been deleted.' : 'Use the links below to view the member directory and your public profile.';
  const detailRows = [
    ['Member name', name], ['Email', email], ['Membership category', category], ['Affiliation', affiliation], ['Country', country], ['Field of expertise', expertise], ['Research papers published', String(member.researchPapersPublished)]
  ].map(([label, value]) => `<tr><td style="padding:10px 12px;border-bottom:1px solid #e3ebe8;color:#6a7f88;font-size:12px;text-transform:uppercase;letter-spacing:.04em;width:42%">${label}</td><td style="padding:10px 12px;border-bottom:1px solid #e3ebe8;color:#173442;font-size:14px;font-weight:600">${value}</td></tr>`).join('');

  await config.transport.sendMail({
    from: config.from,
    to: member.email,
    replyTo: config.contactTo,
    subject: `${content.subject} — ${member.fullName}`,
    text: `Dear ${member.fullName},\n\n${content.heading}\n\n${content.intro}\n\nMember name: ${member.fullName}\nEmail: ${member.email}\nMembership category: ${member.category}\nAffiliation: ${member.affiliation || 'Not provided'}\nCountry: ${member.country || 'Not provided'}\nField of expertise: ${member.fieldOfExpertise || 'Not provided'}\nResearch papers published: ${member.researchPapersPublished}\n\nMembers List: ${membersUrl}\nProfile page: ${profileUrl}\n\n${availabilityNote}\n\nRegards,\nIJPAss Editorial Office\neditor.ijpass@gmail.com`,
    html: `<div style="margin:0;padding:28px 12px;background:#eef4f2;font-family:Arial,sans-serif;color:#173442"><div style="max-width:680px;margin:auto"><div style="background:linear-gradient(135deg,#071f34,#0b5060);padding:30px;border-radius:18px 18px 0 0;color:#fff"><div style="display:inline-block;background:rgba(65,211,173,.16);border:1px solid rgba(65,211,173,.38);border-radius:99px;padding:7px 11px;color:#78e2c6;font-size:11px;font-weight:bold;letter-spacing:.12em">${content.badge}</div><h1 style="margin:18px 0 7px;font-size:27px;line-height:1.2">${content.heading}</h1><p style="margin:0;color:#bed0d7;font-size:14px">International Journal Publishers Association (IJPAss)</p></div><div style="background:#fff;border:1px solid #dce7e4;border-top:0;border-radius:0 0 18px 18px;padding:30px"><p style="font-size:16px;margin-top:0">Dear <strong>${name}</strong>,</p><p style="color:#526b75;line-height:1.7">${content.intro}</p><div style="height:4px;background:${content.accent};border-radius:99px;margin:22px 0"></div><h2 style="font-size:18px;margin:0 0 12px;color:#0a3445">Your member details</h2><table role="presentation" style="border-collapse:collapse;width:100%;background:#f7faf9;border:1px solid #e3ebe8;border-radius:12px;overflow:hidden">${detailRows}</table><div style="margin:24px 0 16px"><a href="${safeProfileUrl}" style="display:inline-block;background:#0c7771;color:#fff;text-decoration:none;border-radius:9px;padding:12px 18px;font-size:14px;font-weight:bold;margin:0 8px 8px 0">View Member Profile</a><a href="${safeMembersUrl}" style="display:inline-block;background:#e7f5f1;color:#0c7771;text-decoration:none;border-radius:9px;padding:12px 18px;font-size:14px;font-weight:bold;margin-bottom:8px">Open Members List</a></div><div style="background:#f2f7f5;border-left:4px solid ${content.accent};padding:13px 15px;border-radius:0 9px 9px 0;color:#587078;font-size:13px;line-height:1.55">${availabilityNote}</div><div style="margin-top:20px;color:#6b8088;font-size:12px;line-height:1.6"><strong>Members List URL</strong><br/><a href="${safeMembersUrl}" style="color:#0c7771;word-break:break-all">${safeMembersUrl}</a><br/><br/><strong>Profile Page URL</strong><br/><a href="${safeProfileUrl}" style="color:#0c7771;word-break:break-all">${safeProfileUrl}</a></div><p style="margin:26px 0 0;color:#526b75;line-height:1.6">Regards,<br/><strong style="color:#173442">IJPAss Editorial Office</strong><br/><a href="mailto:editor.ijpass@gmail.com" style="color:#0c7771">editor.ijpass@gmail.com</a></p></div><p style="text-align:center;color:#81939a;font-size:11px;line-height:1.5;margin:16px 0">This automated confirmation was sent because an administrator changed your IJPAss member record.</p></div></div>`
  });
  return { sent: true, membersUrl, profileUrl };
}
