import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ApplicationType, PrismaClient, UserRole } from '@prisma/client';
import { createToken, requireAuth, requireRole, type AuthRequest } from './auth.js';
import { sendContactEmails, sendMemberNotification, type MemberNotificationAction } from './mail.js';
import multer from 'multer';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const app = express();
const prisma = new PrismaClient();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
const uploadsRoot = path.resolve(process.cwd(), 'uploads');
const memberPhotoDirectory = path.join(uploadsRoot, 'members');
const membershipApplicationDirectory = path.resolve(process.cwd(), 'private-uploads', 'membership-applications');
mkdirSync(memberPhotoDirectory, { recursive: true });
mkdirSync(membershipApplicationDirectory, { recursive: true });
app.use('/uploads', express.static(uploadsRoot));
const memberPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: memberPhotoDirectory,
    filename: (_req, file, callback) => {
      const extensions: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
      callback(null, `${randomUUID()}${extensions[file.mimetype] || ''}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
});
const membershipApplicationUpload = multer({
  storage: multer.diskStorage({
    destination: membershipApplicationDirectory,
    filename: (_req, file, callback) => {
      const extensions: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
      callback(null, `${file.fieldname}-${randomUUID()}${extensions[file.mimetype] || ''}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, callback) => {
    const allowedPhoto = file.fieldname === 'photo' && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    const allowedResume = file.fieldname === 'resume' && ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype);
    if (allowedPhoto || allowedResume) callback(null, true);
    else callback(new Error(`Unsupported ${file.fieldname} file type`));
  }
});
const removeMemberPhoto = async (photo?: string | null) => {
  if (!photo?.startsWith('/uploads/members/')) return;
  const photoPath = path.resolve(process.cwd(), photo.slice(1));
  if (path.dirname(photoPath) !== memberPhotoDirectory) return;
  await unlink(photoPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
};

const loginSchema = z.object({
  email: z.string().email().transform(value => value.toLowerCase()),
  password: z.string().min(8),
  role: z.enum(['SUPER_ADMIN', 'INTERNAL_USER', 'PUBLISHER'])
});
const contactSchema = z.object({ name: z.string().min(2), email: z.string().email(), organization: z.string().optional(), country: z.string().min(2).max(100).optional(), message: z.string().min(10), recaptchaToken: z.string().min(1) });
const membershipApplicationSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().transform(value => value.toLowerCase()),
  phone: z.string().trim().min(7).max(30),
  affiliation: z.string().trim().min(2).max(250),
  country: z.string().trim().min(2).max(100),
  membershipCategoryId: z.coerce.number().int().positive(),
  message: z.string().trim().min(10).max(3000),
  recaptchaToken: z.string().min(1)
});
type StoredApplicationFile = { storedName: string; originalName: string; mimeType: string; size: number };
type MembershipApplicationData = { name: string; email: string; phone: string; affiliation: string; country: string; membershipCategoryId: number; membershipCategory: string; message: string; photo: StoredApplicationFile; resume: StoredApplicationFile };
const membershipApplicationData = (data: unknown) => data as MembershipApplicationData;
const membershipApplicationFilePath = (storedName: string) => {
  const filePath = path.resolve(membershipApplicationDirectory, storedName);
  if (path.dirname(filePath) !== membershipApplicationDirectory) throw new Error('Invalid application file path');
  return filePath;
};
const internalUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
  organization: z.string().max(150).optional(),
  active: z.boolean().default(true)
});
const accountUpdateSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128).optional(),
  organization: z.string().max(150).optional(),
  active: z.boolean()
});
const websiteValue = z.string().trim().transform(value => value ? `https://${value.replace(/^https?:\/\//i, '')}` : '').pipe(z.union([z.string().url(), z.literal('')]));
const publisherSchema = internalUserSchema.extend({
  organization: z.string().min(2).max(150),
  country: z.string().max(100).optional(),
  website: websiteValue.optional()
});
const publisherUpdateSchema = accountUpdateSchema.extend({
  organization: z.string().min(2).max(150),
  country: z.string().max(100).optional(),
  website: websiteValue.optional()
});
const feeValue = z.string().trim().min(1).max(50).transform(value => value.replace(/^[\$₹]\s*/u, ''));
const membershipCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  eligibility: z.string().trim().min(2).max(1000),
  validity: z.string().trim().min(2).max(100),
  usd: feeValue,
  inr: feeValue
});
const profileUrl = z.string().trim().transform(value => value ? `https://${value.replace(/^https?:\/\//i, '')}` : '').pipe(z.union([z.string().url(), z.literal('')]));
const membershipCategoryCodes: Record<string, string> = {
  'Student Member': 'STU', 'Individual Member': 'IND', 'Editor Member': 'EDT', 'Journal Member': 'JRN',
  'Publisher Member': 'PUB', 'Institutional Member': 'INS', 'Corporate Member': 'COR',
  'Life Member (Individual)': 'LIF', 'Honorary Member': 'HON', 'Fellow (FIJPAss)': 'FIJ'
};
const membershipCategoryCode = (name: string) => membershipCategoryCodes[name] || name
  .replace(/\([^)]*\)/g, ' ')
  .split(/\s+/)
  .filter(word => word && !['member', 'membership', 'and', 'of', 'the'].includes(word.toLowerCase()))
  .map(word => word[0]).join('').toUpperCase().padEnd(3, 'X').slice(0, 3);
const membershipYearCode = (date: Date) => `2K${String(date.getUTCFullYear() % 100).padStart(2, '0')}`;
const createMembershipId = (categoryName: string, membershipFrom: Date, memberId: number) => `IJPASS-${membershipCategoryCode(categoryName)}-${membershipYearCode(membershipFrom)}-${String(memberId).padStart(6, '0')}`;
const membershipExpiry = (membershipFrom: Date, validity: string) => {
  if (/life\s*time/i.test(validity)) return null;
  const years = validity.match(/(\d+)\s*years?/i);
  const months = validity.match(/(\d+)\s*months?/i);
  const expiry = new Date(membershipFrom);
  if (years) { expiry.setUTCFullYear(expiry.getUTCFullYear() + Number(years[1])); return expiry; }
  if (months) { expiry.setUTCMonth(expiry.getUTCMonth() + Number(months[1])); return expiry; }
  return null;
};
const memberSchema = z.object({
  membershipCategoryId: z.coerce.number().int().positive(),
  membershipFrom: z.coerce.date(),
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().email().transform(value => value.toLowerCase()),
  affiliation: z.string().trim().max(250).optional(),
  country: z.string().trim().max(100).optional(),
  shortProfile: z.string().trim().max(1500).optional(),
  fieldOfExpertise: z.string().trim().max(250).optional(),
  researchPapersPublished: z.coerce.number().int().min(0).max(100000),
  googleScholarUrl: profileUrl.optional(),
  researchGateUrl: profileUrl.optional(),
  orcid: profileUrl.optional(),
  active: z.enum(['true', 'false']).transform(value => value === 'true')
});
type NotifiableMember = { fullName: string; email: string | null; affiliation: string | null; country: string | null; fieldOfExpertise: string | null; researchPapersPublished: number; membershipCategory: { name: string } };
const queueMemberNotification = (member: NotifiableMember, action: MemberNotificationAction) => {
  if (!member.email) return;
  void sendMemberNotification({ fullName: member.fullName, email: member.email, category: member.membershipCategory.name, affiliation: member.affiliation, country: member.country, fieldOfExpertise: member.fieldOfExpertise, researchPapersPublished: member.researchPapersPublished }, action)
    .then(result => { if (!result.sent) console.warn(`Member ${member.fullName}: email not queued (${result.reason})`); })
    .catch(mailError => console.error(`Member ${member.fullName}: ${action} email delivery failed`, mailError));
};
const disableExpiredMembers = async () => {
  const expired = await prisma.member.findMany({
    where: { active: true, membershipUntil: { not: null, lte: new Date() } },
    include: { membershipCategory: { select: { name: true } } }
  });
  if (!expired.length) return;
  await prisma.member.updateMany({ where: { id: { in: expired.map(member => member.id) } }, data: { active: false } });
  expired.forEach(member => queueMemberNotification(member, 'disabled'));
};

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'IJPAss API' }));

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const valid = user && user.active && user.role === input.role && await bcrypt.compare(input.password, user.password);
    if (!valid) return res.status(401).json({ message: 'Email, password, or access type is incorrect' });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = createToken({ id: user.id, email: user.email, role: user.role });
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email, organization: user.organization, role: user.role } });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.id }, select: { id: true, name: true, email: true, organization: true, role: true, active: true } });
    if (!user?.active) return res.status(401).json({ message: 'Account is inactive' });
    return res.json({ user });
  } catch (error) { next(error); }
});

app.get('/api/admin/summary', requireAuth, requireRole(UserRole.SUPER_ADMIN, UserRole.INTERNAL_USER), async (_req, res, next) => {
  try {
    const [users, journals, applications, messages] = await Promise.all([prisma.user.count(), prisma.journal.count(), prisma.application.count(), prisma.contactMessage.count()]);
    res.json({ users, journals, applications, messages });
  } catch (error) { next(error); }
});

app.get('/api/admin/internal-users', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({ where: { role: UserRole.INTERNAL_USER }, select: { id: true, name: true, email: true, organization: true, role: true, active: true, lastLoginAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    res.json({ users });
  } catch (error) { next(error); }
});

app.get('/api/membership-categories', async (_req, res, next) => {
  try {
    const categories = await prisma.membershipCategory.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return res.json({ categories });
  } catch (error) { next(error); }
});

app.get('/api/members', async (req, res, next) => {
  try {
    await disableExpiredMembers();
    const query = String(req.query.q || '').trim();
    const [categories, memberRecords] = await Promise.all([
      prisma.membershipCategory.findMany({ where: { active: true }, select: { id: true, name: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.member.findMany({
        where: { active: true, ...(query ? { fullName: { contains: query } } : {}) },
        include: { membershipCategory: { select: { name: true } } },
        orderBy: { fullName: 'asc' }
      })
    ]);
    const members = memberRecords.map(member => ({ id: member.id, name: member.fullName, category: member.membershipCategory.name, affiliation: member.affiliation, country: member.country, photo: member.photo, shortProfile: member.shortProfile, fieldOfExpertise: member.fieldOfExpertise, researchPapersPublished: member.researchPapersPublished, googleScholarUrl: member.googleScholarUrl, researchGateUrl: member.researchGateUrl, orcid: member.orcid }));
    return res.json({ categories, members });
  } catch (error) { next(error); }
});

app.get('/api/members/:memberName', async (req, res, next) => {
  try {
    await disableExpiredMembers();
    const fullName = z.string().trim().min(2).max(150).parse(req.params.memberName.replace(/_/g, ' '));
    const member = await prisma.member.findFirst({
      where: { fullName, active: true },
      include: { membershipCategory: { select: { name: true, active: true } } }
    });
    if (!member || !member.membershipCategory.active) return res.status(404).json({ message: 'Member profile not found' });
    return res.json({ member: {
      id: member.id,
      name: member.fullName,
      category: member.membershipCategory.name,
      affiliation: member.affiliation,
      country: member.country,
      photo: member.photo,
      shortProfile: member.shortProfile,
      fieldOfExpertise: member.fieldOfExpertise,
      researchPapersPublished: member.researchPapersPublished,
      googleScholarUrl: member.googleScholarUrl,
      researchGateUrl: member.researchGateUrl,
      orcid: member.orcid
    } });
  } catch (error) { next(error); }
});

app.get('/api/admin/members', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (_req, res, next) => {
  try {
    await disableExpiredMembers();
    const members = await prisma.member.findMany({ include: { membershipCategory: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } });
    return res.json({ members });
  } catch (error) { next(error); }
});

app.post('/api/admin/members', requireAuth, requireRole(UserRole.SUPER_ADMIN), memberPhotoUpload.single('photo'), async (req, res, next) => {
  try {
    const input = memberSchema.parse(req.body);
    const category = await prisma.membershipCategory.findFirst({ where: { id: input.membershipCategoryId, active: true } });
    if (!category) return res.status(400).json({ message: 'Select a valid membership category' });
    const existingName = await prisma.member.findFirst({ where: { fullName: input.fullName } });
    if (existingName) return res.status(409).json({ message: 'A member with this full name already exists. Member names must be unique for public profile URLs.' });
    const membershipUntil = membershipExpiry(input.membershipFrom, category.validity);
    const active = input.active && (!membershipUntil || membershipUntil > new Date());
    const member = await prisma.$transaction(async transaction => {
      const created = await transaction.member.create({ data: { ...input, active, membershipUntil, affiliation: input.affiliation || null, country: input.country || null, shortProfile: input.shortProfile || null, fieldOfExpertise: input.fieldOfExpertise || null, googleScholarUrl: input.googleScholarUrl || null, researchGateUrl: input.researchGateUrl || null, orcid: input.orcid || null, photo: req.file ? `/uploads/members/${req.file.filename}` : null } });
      return transaction.member.update({ where: { id: created.id }, data: { membershipId: createMembershipId(category.name, input.membershipFrom, created.id) }, include: { membershipCategory: { select: { id: true, name: true } } } });
    });
    queueMemberNotification(member, 'created');
    return res.status(201).json({ message: 'Member created successfully', member });
  } catch (error) { next(error); }
});

app.put('/api/admin/members/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), memberPhotoUpload.single('photo'), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = memberSchema.parse(req.body);
    const [current, category, existingName] = await Promise.all([
      prisma.member.findUnique({ where: { id } }),
      prisma.membershipCategory.findUnique({ where: { id: input.membershipCategoryId } }),
      prisma.member.findFirst({ where: { fullName: input.fullName, NOT: { id } } })
    ]);
    if (!current) return res.status(404).json({ message: 'Member record not found' });
    if (!category) return res.status(400).json({ message: 'Select a valid membership category' });
    if (existingName) return res.status(409).json({ message: 'A member with this full name already exists. Member names must be unique for public profile URLs.' });
    const membershipUntil = membershipExpiry(input.membershipFrom, category.validity);
    const active = input.active && (!membershipUntil || membershipUntil > new Date());
    const member = await prisma.member.update({
      where: { id },
      data: { ...input, active, membershipId: createMembershipId(category.name, input.membershipFrom, id), membershipUntil, affiliation: input.affiliation || null, country: input.country || null, shortProfile: input.shortProfile || null, fieldOfExpertise: input.fieldOfExpertise || null, googleScholarUrl: input.googleScholarUrl || null, researchGateUrl: input.researchGateUrl || null, orcid: input.orcid || null, photo: req.file ? `/uploads/members/${req.file.filename}` : current.photo },
      include: { membershipCategory: { select: { id: true, name: true } } }
    });
    if (req.file && current.photo) await removeMemberPhoto(current.photo);
    queueMemberNotification(member, current.active === member.active ? 'updated' : member.active ? 'enabled' : 'disabled');
    return res.json({ message: 'Member updated successfully', member });
  } catch (error) { next(error); }
});

app.patch('/api/admin/members/:id/status', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const member = await prisma.member.update({ where: { id }, data: { active }, include: { membershipCategory: { select: { name: true } } } });
    queueMemberNotification(member, active ? 'enabled' : 'disabled');
    return res.json({ message: `Member ${active ? 'enabled' : 'disabled'} successfully`, member });
  } catch (error) { next(error); }
});

app.delete('/api/admin/members/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const member = await prisma.member.findUnique({ where: { id }, include: { membershipCategory: { select: { name: true } } } });
    if (!member) return res.status(404).json({ message: 'Member record not found' });
    await prisma.member.delete({ where: { id } });
    await removeMemberPhoto(member.photo);
    queueMemberNotification(member, 'deleted');
    return res.json({ message: 'Member deleted successfully' });
  } catch (error) { next(error); }
});

app.get('/api/admin/membership-categories', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (_req, res, next) => {
  try {
    const categories = await prisma.membershipCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return res.json({ categories });
  } catch (error) { next(error); }
});

app.post('/api/admin/membership-categories', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const input = membershipCategorySchema.parse(req.body);
    const last = await prisma.membershipCategory.aggregate({ _max: { sortOrder: true } });
    const category = await prisma.membershipCategory.create({ data: { ...input, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
    return res.status(201).json({ message: 'Membership category created successfully', category });
  } catch (error) { next(error); }
});

app.put('/api/admin/membership-categories/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = membershipCategorySchema.parse(req.body);
    const category = await prisma.membershipCategory.update({ where: { id }, data: input });
    return res.json({ message: 'Membership category updated successfully', category });
  } catch (error) { next(error); }
});

app.delete('/api/admin/membership-categories/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    await prisma.membershipCategory.delete({ where: { id } });
    return res.json({ message: 'Membership category deleted successfully' });
  } catch (error) { next(error); }
});

app.post('/api/admin/internal-users', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const input = internalUserSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) return res.status(409).json({ message: 'An account already exists with this email address' });
    const password = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({ data: { name: input.name, email: input.email, password, organization: input.organization || 'IJPAss', role: UserRole.INTERNAL_USER, active: input.active }, select: { id: true, name: true, email: true, organization: true, role: true, active: true, createdAt: true } });
    return res.status(201).json({ message: 'Internal User created successfully', user });
  } catch (error) { next(error); }
});

app.put('/api/admin/internal-users/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = accountUpdateSchema.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { id, role: UserRole.INTERNAL_USER } });
    if (!existing) return res.status(404).json({ message: 'Internal User not found' });
    const duplicate = await prisma.user.findFirst({ where: { email: input.email, NOT: { id } } });
    if (duplicate) return res.status(409).json({ message: 'An account already exists with this email address' });
    const { password, ...details } = input;
    const user = await prisma.user.update({ where: { id }, data: { ...details, ...(password ? { password: await bcrypt.hash(password, 12) } : {}) }, select: { id: true, name: true, email: true, organization: true, active: true, createdAt: true } });
    return res.json({ message: 'Internal User updated successfully', user });
  } catch (error) { next(error); }
});

app.delete('/api/admin/internal-users/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const existing = await prisma.user.findFirst({ where: { id, role: UserRole.INTERNAL_USER } });
    if (!existing) return res.status(404).json({ message: 'Internal User not found' });
    await prisma.user.delete({ where: { id } });
    return res.json({ message: 'Internal User deleted successfully' });
  } catch (error) { next(error); }
});

app.get('/api/admin/publishers', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (_req, res, next) => {
  try {
    const publishers = await prisma.user.findMany({ where: { role: UserRole.PUBLISHER }, select: { id: true, name: true, email: true, organization: true, country: true, website: true, active: true, lastLoginAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    return res.json({ publishers });
  } catch (error) { next(error); }
});

app.post('/api/admin/publishers', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const input = publisherSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) return res.status(409).json({ message: 'An account already exists with this email address' });
    const password = await bcrypt.hash(input.password, 12);
    const publisher = await prisma.user.create({ data: { name: input.name, email: input.email, password, organization: input.organization, country: input.country || null, website: input.website || null, role: UserRole.PUBLISHER, active: input.active }, select: { id: true, name: true, email: true, organization: true, country: true, website: true, active: true, createdAt: true } });
    return res.status(201).json({ message: 'Publisher account created successfully', publisher });
  } catch (error) { next(error); }
});

app.put('/api/admin/publishers/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = publisherUpdateSchema.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { id, role: UserRole.PUBLISHER } });
    if (!existing) return res.status(404).json({ message: 'Publisher account not found' });
    const duplicate = await prisma.user.findFirst({ where: { email: input.email, NOT: { id } } });
    if (duplicate) return res.status(409).json({ message: 'An account already exists with this email address' });
    const { password, ...details } = input;
    const publisher = await prisma.user.update({ where: { id }, data: { ...details, country: details.country || null, website: details.website || null, ...(password ? { password: await bcrypt.hash(password, 12) } : {}) }, select: { id: true, name: true, email: true, organization: true, country: true, website: true, active: true, createdAt: true } });
    return res.json({ message: 'Publisher account updated successfully', publisher });
  } catch (error) { next(error); }
});

app.delete('/api/admin/publishers/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const existing = await prisma.user.findFirst({ where: { id, role: UserRole.PUBLISHER } });
    if (!existing) return res.status(404).json({ message: 'Publisher account not found' });
    await prisma.user.delete({ where: { id } });
    return res.json({ message: 'Publisher account deleted successfully' });
  } catch (error) { next(error); }
});

app.get('/api/admin/contact-enquiries', requireAuth, requireRole(UserRole.SUPER_ADMIN, UserRole.INTERNAL_USER), async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    const enquiries = await prisma.contactMessage.findMany({
      where: query ? { OR: [{ name: { contains: query } }, { email: { contains: query } }, { organization: { contains: query } }, { country: { contains: query } }] } : {},
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    res.json({ enquiries });
  } catch (error) { next(error); }
});

app.delete('/api/admin/contact-enquiries/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const existing = await prisma.contactMessage.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Contact enquiry not found' });
    await prisma.contactMessage.delete({ where: { id } });
    return res.json({ message: 'Contact enquiry deleted successfully' });
  } catch (error) { next(error); }
});

app.get('/api/admin/membership-applications', requireAuth, requireRole(UserRole.SUPER_ADMIN, UserRole.INTERNAL_USER), async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim().toLocaleLowerCase();
    const applications = await prisma.application.findMany({ where: { type: ApplicationType.MEMBERSHIP }, orderBy: { createdAt: 'desc' }, take: 500 });
    const records = applications.map(application => {
      const data = membershipApplicationData(application.data);
      return { id: application.id, reference: application.reference, status: application.status, createdAt: application.createdAt, name: data.name, email: data.email, phone: data.phone, affiliation: data.affiliation, country: data.country, membershipCategory: data.membershipCategory, message: data.message, photo: data.photo ? { originalName: data.photo.originalName, size: data.photo.size } : null, resume: data.resume ? { originalName: data.resume.originalName, size: data.resume.size } : null };
    }).filter(application => !query || [application.reference, application.name, application.email, application.phone, application.affiliation, application.country, application.membershipCategory, application.message].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    return res.json({ applications: records });
  } catch (error) { next(error); }
});

app.get('/api/admin/membership-applications/:id/files/:kind', requireAuth, requireRole(UserRole.SUPER_ADMIN, UserRole.INTERNAL_USER), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const kind = z.enum(['photo', 'resume']).parse(req.params.kind);
    const application = await prisma.application.findFirst({ where: { id, type: ApplicationType.MEMBERSHIP } });
    if (!application) return res.status(404).json({ message: 'Membership application not found' });
    const file = membershipApplicationData(application.data)[kind];
    if (!file?.storedName) return res.status(404).json({ message: `${kind === 'photo' ? 'Photo' : 'Resume'} file not found` });
    return res.download(membershipApplicationFilePath(file.storedName), file.originalName);
  } catch (error) { next(error); }
});

app.delete('/api/admin/membership-applications/:id', requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const application = await prisma.application.findFirst({ where: { id, type: ApplicationType.MEMBERSHIP } });
    if (!application) return res.status(404).json({ message: 'Membership application not found' });
    const data = membershipApplicationData(application.data);
    const files = [data.photo?.storedName, data.resume?.storedName].filter((name): name is string => Boolean(name));
    await Promise.all(files.map(name => unlink(membershipApplicationFilePath(name)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; })));
    await prisma.application.delete({ where: { id } });
    return res.json({ message: 'Membership application deleted successfully' });
  } catch (error) { next(error); }
});

app.post('/api/contact', async (req, res, next) => {
  try {
    const input = contactSchema.parse(req.body);
    const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
    if (!secret) {
      console.error('RECAPTCHA_SECRET_KEY is not configured');
      return res.status(503).json({ message: 'Contact form verification is temporarily unavailable.' });
    }
    const verificationBody = new URLSearchParams({ secret, response: input.recaptchaToken });
    const verificationResponse = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verificationBody
    });
    if (!verificationResponse.ok) throw new Error(`reCAPTCHA verification returned HTTP ${verificationResponse.status}`);
    const verification = z.object({ success: z.boolean(), hostname: z.string().optional(), 'error-codes': z.array(z.string()).optional() }).parse(await verificationResponse.json());
    if (!verification.success) return res.status(400).json({ message: 'reCAPTCHA verification failed or expired. Please try again.' });

    const { recaptchaToken: _recaptchaToken, ...contact } = input;
    const saved = await prisma.contactMessage.create({ data: contact });
    void sendContactEmails(contact, saved.id)
      .then(result => { if (!result.sent) console.warn(`Contact ${saved.id}: ${result.reason}`); })
      .catch(mailError => console.error(`Contact ${saved.id}: email delivery failed`, mailError));
    return res.status(201).json({ message: 'Enquiry received', id: saved.id, reference: `ENQ-${String(saved.id).padStart(6, '0')}`, emailQueued: true });
  } catch (error) { next(error); }
});

app.post('/api/membership-applications', membershipApplicationUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'resume', maxCount: 1 }]), async (req, res, next) => {
  const files = req.files as { photo?: Express.Multer.File[]; resume?: Express.Multer.File[] } | undefined;
  const uploadedFiles = [...(files?.photo || []), ...(files?.resume || [])];
  const removeUploads = async () => Promise.all(uploadedFiles.map(file => unlink(file.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; })));
  try {
    const input = membershipApplicationSchema.parse(req.body);
    const photo = files?.photo?.[0];
    const resume = files?.resume?.[0];
    if (!photo || !resume) {
      await removeUploads();
      return res.status(400).json({ message: 'A photo and Resume file are required.' });
    }
    const category = await prisma.membershipCategory.findFirst({ where: { id: input.membershipCategoryId, active: true }, select: { id: true, name: true } });
    if (!category) {
      await removeUploads();
      return res.status(400).json({ message: 'Select a valid membership category.' });
    }
    const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
    if (!secret) {
      await removeUploads();
      console.error('RECAPTCHA_SECRET_KEY is not configured');
      return res.status(503).json({ message: 'Membership form verification is temporarily unavailable.' });
    }
    const verificationResponse = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: input.recaptchaToken })
    });
    if (!verificationResponse.ok) throw new Error(`reCAPTCHA verification returned HTTP ${verificationResponse.status}`);
    const verification = z.object({ success: z.boolean() }).passthrough().parse(await verificationResponse.json());
    if (!verification.success) {
      await removeUploads();
      return res.status(400).json({ message: 'reCAPTCHA verification failed or expired. Please try again.' });
    }
    const reference = `MEM-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const application = await prisma.application.create({
      data: {
        reference,
        type: ApplicationType.MEMBERSHIP,
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          affiliation: input.affiliation,
          country: input.country,
          membershipCategoryId: category.id,
          membershipCategory: category.name,
          message: input.message,
          photo: { storedName: photo.filename, originalName: photo.originalname, mimeType: photo.mimetype, size: photo.size },
          resume: { storedName: resume.filename, originalName: resume.originalname, mimeType: resume.mimetype, size: resume.size }
        }
      }
    });
    return res.status(201).json({ message: 'Membership application received', id: application.id, reference });
  } catch (error) {
    await removeUploads().catch(cleanupError => console.error('Membership application upload cleanup failed', cleanupError));
    next(error);
  }
});
app.get('/api/applications/:reference', async (req, res, next) => { try { const item = await prisma.application.findUnique({ where: { reference: req.params.reference } }); if (!item) return res.status(404).json({ message: 'Application not found' }); return res.json(item); } catch (error) { next(error); } });
app.get('/api/journals', async (req, res, next) => { try { const query = String(req.query.q || ''); const journals = await prisma.journal.findMany({ where: query ? { OR: [{ title: { contains: query } }, { publisher: { contains: query } }, { issn: { contains: query } }] } : {}, take: 50 }); res.json(journals); } catch (error) { next(error); } });

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'An uploaded file exceeds the 5 MB limit.' : error.message });
  if (error instanceof Error && error.message.startsWith('Unsupported ')) return res.status(400).json({ message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation failed', issues: error.issues });
  console.error(error);
  return res.status(500).json({ message: 'Internal server error' });
});

const port = Number(process.env.PORT || 4000);
void disableExpiredMembers().catch(error => console.error('Initial membership expiry check failed', error));
const membershipExpiryTimer = setInterval(() => {
  void disableExpiredMembers().catch(error => console.error('Scheduled membership expiry check failed', error));
}, 60 * 60 * 1000);
membershipExpiryTimer.unref();
app.listen(port, () => console.log(`IJPAss API running on http://localhost:${port}`));
