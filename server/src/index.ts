import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  ApplicationType,
  Prisma,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import {
  createToken,
  requireAuth,
  requireRole,
  type AuthRequest,
} from "./auth.js";
import {
  sendContactEmails,
  sendMemberNotification,
  type MemberNotificationAction,
} from "./mail.js";
import multer from "multer";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  elasticHealth,
  removeAffiliationSearchDocuments,
  removeAuthorSearchDocuments,
  searchAuthorIds,
  searchCountryIds,
  searchIndexIds,
  searchManuscriptIds,
  searchMemberIds,
} from "./elasticsearch.js";
import { getResourceMetrics } from "./resource-metrics.js";

const app = express();
const prisma = new PrismaClient();
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
const uploadsRoot = path.resolve(process.cwd(), "uploads");
const memberPhotoDirectory = path.join(uploadsRoot, "members");
const membershipApplicationDirectory = path.resolve(
  process.cwd(),
  "private-uploads",
  "membership-applications",
);
mkdirSync(memberPhotoDirectory, { recursive: true });
mkdirSync(membershipApplicationDirectory, { recursive: true });
app.use("/uploads", express.static(uploadsRoot));
const memberPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: memberPhotoDirectory,
    filename: (_req, file, callback) => {
      const extensions: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
      };
      callback(null, `${randomUUID()}${extensions[file.mimetype] || ""}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) =>
    callback(
      null,
      ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype),
    ),
});
const membershipApplicationUpload = multer({
  storage: multer.diskStorage({
    destination: membershipApplicationDirectory,
    filename: (_req, file, callback) => {
      const extensions: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "application/pdf": ".pdf",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          ".docx",
      };
      callback(
        null,
        `${file.fieldname}-${randomUUID()}${extensions[file.mimetype] || ""}`,
      );
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, callback) => {
    const allowedPhoto =
      file.fieldname === "photo" &&
      ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    const allowedResume =
      file.fieldname === "resume" &&
      [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(file.mimetype);
    if (allowedPhoto || allowedResume) callback(null, true);
    else callback(new Error(`Unsupported ${file.fieldname} file type`));
  },
});
const removeMemberPhoto = async (photo?: string | null) => {
  if (!photo?.startsWith("/uploads/members/")) return;
  const photoPath = path.resolve(process.cwd(), photo.slice(1));
  if (path.dirname(photoPath) !== memberPhotoDirectory) return;
  await unlink(photoPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
};

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  role: z.enum(["SUPER_ADMIN", "INTERNAL_USER", "PUBLISHER"]),
});
const contactSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  organization: z.string().optional(),
  country: z.string().min(2).max(100).optional(),
  message: z.string().min(10),
  recaptchaToken: z.string().min(1),
});
const membershipApplicationSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(7).max(30),
  affiliation: z.string().trim().min(2).max(250),
  country: z.string().trim().min(2).max(100),
  membershipCategoryId: z.coerce.number().int().positive(),
  message: z.string().trim().min(10).max(3000),
  recaptchaToken: z.string().min(1),
});
type StoredApplicationFile = {
  storedName: string;
  originalName: string;
  mimeType: string;
  size: number;
};
type MembershipApplicationData = {
  name: string;
  email: string;
  phone: string;
  affiliation: string;
  country: string;
  membershipCategoryId: number;
  membershipCategory: string;
  message: string;
  photo: StoredApplicationFile;
  resume: StoredApplicationFile;
};
const membershipApplicationData = (data: unknown) =>
  data as MembershipApplicationData;
const membershipApplicationFilePath = (storedName: string) => {
  const filePath = path.resolve(membershipApplicationDirectory, storedName);
  if (path.dirname(filePath) !== membershipApplicationDirectory)
    throw new Error("Invalid application file path");
  return filePath;
};
const internalPermissionIds = [
  "journal-publishers",
  "sources",
  "manuscripts",
  "author-profiles",
  "affiliation-profiles",
  "membership-categories",
  "members",
  "author-merge-requests",
  "affiliation-merge-requests",
  "applications",
] as const;
type InternalPermission = (typeof internalPermissionIds)[number];
const internalPermissionSchema = z.enum(internalPermissionIds);
const internalUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  organization: z.string().max(150).optional(),
  active: z.boolean().default(true),
  permissions: z.array(internalPermissionSchema).default([]),
});
const accountUpdateSchema = z.object({
  name: z.string().min(2).max(100),
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128).optional(),
  organization: z.string().max(150).optional(),
  active: z.boolean(),
  permissions: z.array(internalPermissionSchema),
});
const websiteValue = z
  .string()
  .trim()
  .transform((value) =>
    value ? `https://${value.replace(/^https?:\/\//i, "")}` : "",
  )
  .pipe(z.union([z.string().url(), z.literal("")]));
const publisherSchema = internalUserSchema.extend({
  organization: z.string().min(2).max(150),
  country: z.string().max(100).optional(),
  website: websiteValue.optional(),
});
const publisherUpdateSchema = accountUpdateSchema.extend({
  organization: z.string().min(2).max(150),
  country: z.string().max(100).optional(),
  website: websiteValue.optional(),
});
const journalPublisherSchema = z.object({
  publisherName: z.string().trim().min(2).max(255),
  chiefEditor: z.string().trim().max(255).optional(),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  website: websiteValue.optional(),
  address: z.string().trim().max(2000).optional(),
  country: z.string().trim().max(100).optional(),
  active: z.boolean().default(true),
});
const authorProfileSchema = z.object({
  salutation: z
    .enum(["Mr.", "Dr.", "Prof. Dr.", "Ms.", "Mrs.", "Er."])
    .or(z.literal(""))
    .optional(),
  authorName: z.string().trim().min(2).max(555),
  department: z.string().trim().max(500).optional().default(""),
  designation: z.string().trim().max(500).optional().default(""),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  orcid: z.string().trim().max(50).optional(),
  affiliations: z.array(z.object({
    affiliationId: z.coerce.number().int().positive(),
  })).max(100).optional(),
});
const authorQualificationsPattern =
  /\s*,?\s*(?:Ph\.?\s*D\.?|D\.?\s*Sc\.?|M\.?\s*D\.?)\s*,?/gi;
const authorSalutations: [string, string][] = [
  ["Prof. Dr.", "Prof. Dr."],
  ["Prof Dr", "Prof. Dr."],
  ["Dr.", "Dr."],
  ["Dr", "Dr."],
  ["Mr.", "Mr."],
  ["Mr", "Mr."],
  ["Ms.", "Ms."],
  ["Ms", "Ms."],
  ["Mrs.", "Mrs."],
  ["Mrs", "Mrs."],
  ["Er.", "Er."],
  ["Er", "Er."],
];
const normalizeAuthorProfile = (input: z.infer<typeof authorProfileSchema>) => {
  let authorName = input.authorName
    .replace(/^[,\s]+/, "")
    .replace(authorQualificationsPattern, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
  let salutation = input.salutation || "";
  for (const [prefix, canonical] of authorSalutations) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      pattern = prefix.endsWith(".")
        ? new RegExp(`^${escaped}\\s*,?\\s*`, "i")
        : new RegExp(`^${escaped}(?:\\s*,\\s*|\\s+)`, "i");
    if (pattern.test(authorName)) {
      authorName = authorName
        .replace(pattern, "")
        .replace(/^[,\s]+/, "")
        .trim();
      if (!salutation) salutation = canonical;
      break;
    }
  }
  if (authorName.length < 2)
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["authorName"],
        message: "Enter the author name without qualifications",
      },
    ]);
  return { ...input, authorName, salutation };
};
const affiliationProfileSchema = z.object({
  universityCompany: z.string().trim().min(2).max(500),
  cityTerritory: z.string().trim().max(255).optional(),
  address: z.string().trim().max(255).optional(),
  country: z.string().trim().max(255).optional(),
});
const majorSubjectSchema = z.object({
  majorSubject: z.string().trim().min(2).max(255),
});
const subjectClassificationSchema = z.object({
  majorSubjectId: z.coerce.number().int().positive(),
  classificationName: z.string().trim().min(2).max(255),
});
const subjectAreaSchema = z.object({
  classificationId: z.coerce.number().int().positive(),
  subjectArea: z.string().trim().min(2).max(255),
});
const subjectAreaRecordKey = (input: { majorSubject: string; classificationName: string; subjectArea: string }) =>
  createHash("sha256")
    .update(`${input.majorSubject}\u0000${input.classificationName}\u0000${input.subjectArea}`.toLocaleLowerCase("en"))
    .digest("hex");
const sourceRecordSchema = z.object({
  journalId: z.coerce.number().int().positive(),
  journalTitle: z.string().trim().min(2).max(255),
  abbreviation: z.string().trim().max(100).optional(),
  printIssn: z.string().trim().max(20).optional(),
  onlineIssn: z.string().trim().max(20).optional(),
  subjectArea: z.string().trim().max(255).optional(),
  sourceType: z.string().trim().min(2).max(50).default("Journal"),
  publisherId: z.coerce.number().int().positive(),
  indexedFromYear: z
    .union([
      z.coerce.number().int().min(1000).max(9999),
      z.literal(""),
      z.null(),
    ])
    .optional(),
  website: websiteValue.optional(),
  email: z.string().trim().max(500).optional(),
  active: z.boolean().default(true),
});
const manuscriptAuthorAssignmentSchema = z.object({
  authorProfileId: z.coerce.number().int().positive(),
  affiliationId: z.coerce.number().int().positive(),
  designation: z.string().trim().max(500).optional().default(""),
});
const manuscriptRecordSchema = z.object({
  articleCode: z.string().trim().min(1).max(45),
  articleTitle: z.string().trim().min(2),
  journalId: z.coerce.number().int().positive(),
  subjectAreaId: z.coerce.number().int().positive(),
  authorId: z
    .union([z.coerce.number().int().positive(), z.literal(""), z.null()])
    .optional(),
  primaryAuthorProfileId: z
    .union([z.coerce.number().int().positive(), z.literal(""), z.null()])
    .optional(),
  volume: z.string().trim().max(45).optional(),
  issue: z.string().trim().max(45).optional(),
  pages: z.string().trim().max(100).optional(),
  publicationMonth: z.string().trim().max(45).optional(),
  publicationYear: z
    .union([
      z.coerce.number().int().min(1000).max(9999),
      z.literal(""),
      z.null(),
    ])
    .optional(),
  doi: z.string().trim().max(255).optional(),
  articleLink: websiteValue.optional(),
  abstract: z.string().optional(),
  keywords: z.string().optional(),
  authors: z.array(manuscriptAuthorAssignmentSchema).max(50).optional().default([]),
}).superRefine((value, context) => {
  if (!value.authors.length && !value.authorId)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["authors"], message: "Add at least one author" });
  const profileIds = value.authors.map((author) => author.authorProfileId);
  if (new Set(profileIds).size !== profileIds.length)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["authors"], message: "The same author profile cannot be added twice" });
});
const feeValue = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .transform((value) => value.replace(/^[\$₹]\s*/u, ""));
const membershipCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  eligibility: z.string().trim().min(2).max(1000),
  validity: z.string().trim().min(2).max(100),
  usd: feeValue,
  inr: feeValue,
});
const profileUrl = z
  .string()
  .trim()
  .transform((value) =>
    value ? `https://${value.replace(/^https?:\/\//i, "")}` : "",
  )
  .pipe(z.union([z.string().url(), z.literal("")]));
const membershipCategoryCodes: Record<string, string> = {
  "Student Member": "STU",
  "Individual Member": "IND",
  "Editor Member": "EDT",
  "Journal Member": "JRN",
  "Publisher Member": "PUB",
  "Institutional Member": "INS",
  "Corporate Member": "COR",
  "Life Member (Individual)": "LIF",
  "Honorary Member": "HON",
  "Fellow (FIJPAss)": "FIJ",
};
const membershipCategoryCode = (name: string) =>
  membershipCategoryCodes[name] ||
  name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word &&
        !["member", "membership", "and", "of", "the"].includes(
          word.toLowerCase(),
        ),
    )
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .padEnd(3, "X")
    .slice(0, 3);
const membershipYearCode = (date: Date) =>
  `2K${String(date.getUTCFullYear() % 100).padStart(2, "0")}`;
const createMembershipId = (
  categoryName: string,
  membershipFrom: Date,
  memberId: number,
) =>
  `IJPASS-${membershipCategoryCode(categoryName)}-${membershipYearCode(membershipFrom)}-${String(memberId).padStart(6, "0")}`;
const membershipExpiry = (membershipFrom: Date, validity: string) => {
  if (/life\s*time/i.test(validity)) return null;
  const years = validity.match(/(\d+)\s*years?/i);
  const months = validity.match(/(\d+)\s*months?/i);
  const expiry = new Date(membershipFrom);
  if (years) {
    expiry.setUTCFullYear(expiry.getUTCFullYear() + Number(years[1]));
    return expiry;
  }
  if (months) {
    expiry.setUTCMonth(expiry.getUTCMonth() + Number(months[1]));
    return expiry;
  }
  return null;
};
const memberSchema = z.object({
  membershipCategoryId: z.coerce.number().int().positive(),
  membershipFrom: z.coerce.date(),
  fullName: z.string().trim().min(2).max(150),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  affiliation: z.string().trim().max(250).optional(),
  country: z.string().trim().max(100).optional(),
  shortProfile: z.string().trim().max(1500).optional(),
  fieldOfExpertise: z.string().trim().max(250).optional(),
  researchPapersPublished: z.coerce.number().int().min(0).max(100000),
  googleScholarUrl: profileUrl.optional(),
  researchGateUrl: profileUrl.optional(),
  orcid: profileUrl.optional(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});
type NotifiableMember = {
  fullName: string;
  email: string | null;
  affiliation: string | null;
  country: string | null;
  fieldOfExpertise: string | null;
  researchPapersPublished: number;
  membershipCategory: { name: string };
};
const queueMemberNotification = (
  member: NotifiableMember,
  action: MemberNotificationAction,
) => {
  if (!member.email) return;
  void sendMemberNotification(
    {
      fullName: member.fullName,
      email: member.email,
      category: member.membershipCategory.name,
      affiliation: member.affiliation,
      country: member.country,
      fieldOfExpertise: member.fieldOfExpertise,
      researchPapersPublished: member.researchPapersPublished,
    },
    action,
  )
    .then((result) => {
      if (!result.sent)
        console.warn(
          `Member ${member.fullName}: email not queued (${result.reason})`,
        );
    })
    .catch((mailError) =>
      console.error(
        `Member ${member.fullName}: ${action} email delivery failed`,
        mailError,
      ),
    );
};
const disableExpiredMembers = async () => {
  const expired = await prisma.member.findMany({
    where: { active: true, membershipUntil: { not: null, lte: new Date() } },
    include: { membershipCategory: { select: { name: true } } },
  });
  if (!expired.length) return;
  await prisma.member.updateMany({
    where: { id: { in: expired.map((member) => member.id) } },
    data: { active: false },
  });
  expired.forEach((member) => queueMemberNotification(member, "disabled"));
};
const ensureSourceActiveColumn = async () => {
  const [column] = await prisma.$queryRaw<Array<{ columnCount: bigint }>>(Prisma.sql`
    SELECT COUNT(*) columnCount
    FROM information_schema.columns
    WHERE table_schema='ijpass_journals'
      AND table_name='sourcedata_tbl'
      AND column_name='active'
  `);
  if (Number(column?.columnCount || 0)) return;
  await prisma.$executeRawUnsafe(`
    ALTER TABLE ijpass_journals.sourcedata_tbl
    ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER email
  `);
};
const ensurePublisherActiveColumn = async () => {
  const [column] = await prisma.$queryRaw<Array<{ columnCount: bigint }>>(Prisma.sql`
    SELECT COUNT(*) columnCount
    FROM information_schema.columns
    WHERE table_schema='ijpass_journals'
      AND table_name='publisher_tbl'
      AND column_name='active'
  `);
  if (Number(column?.columnCount || 0)) return;
  await prisma.$executeRawUnsafe(`
    ALTER TABLE ijpass_journals.publisher_tbl
    ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER country
  `);
};

app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", service: "IJPAss API" }),
);
app.get("/api/search/health", async (_req, res) =>
  res.json(await elasticHealth()),
);
app.get("/api/indexing/resources/suggestions", async (req, res, next) => {
  try {
    const { q, field } = z.object({
      q: z.string().trim().min(2).max(150),
      field: z.enum(["resourceTitle", "subject", "publisher", "manuscriptTitle"]).catch("resourceTitle"),
    }).parse(req.query);
    const fallback = field === "subject"
      ? await prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT DISTINCT TRIM(source.subject_area) value FROM ijpass_journals.sourcedata_tbl source LEFT JOIN ijpass_journals.publisher_tbl publisher ON publisher.publisher_id=source.publisher_id WHERE COALESCE(source.active,1)=1 AND COALESCE(publisher.active,1)=1 ${inactivePublisherGuard} AND source.subject_area LIKE ${`%${q}%`} AND TRIM(source.subject_area)<>'' ORDER BY value LIMIT 8`)
      : field === "publisher"
        ? await prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT DISTINCT TRIM(COALESCE(publisher.publisher_name,source.publisher)) value FROM ijpass_journals.sourcedata_tbl source LEFT JOIN ijpass_journals.publisher_tbl publisher ON publisher.publisher_id=source.publisher_id WHERE COALESCE(source.active,1)=1 AND COALESCE(publisher.active,1)=1 ${inactivePublisherGuard} AND COALESCE(publisher.publisher_name,source.publisher) LIKE ${`%${q}%`} ORDER BY value LIMIT 8`)
      : field === "manuscriptTitle"
          ? await prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT DISTINCT TRIM(manuscript.article_title) value FROM ijpass_journals.manuscript_tbl manuscript INNER JOIN ijpass_journals.sourcedata_tbl visible_source ON visible_source.source_data_id=manuscript.journal_id LEFT JOIN ijpass_journals.publisher_tbl visible_publisher ON visible_publisher.publisher_id=visible_source.publisher_id WHERE COALESCE(visible_source.active,1)=1 AND COALESCE(visible_publisher.active,1)=1 ${inactiveVisiblePublisherGuard} AND manuscript.article_title LIKE ${`%${q}%`} ORDER BY value LIMIT 8`)
        : await prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT DISTINCT TRIM(source.journal_title) value FROM ijpass_journals.sourcedata_tbl source LEFT JOIN ijpass_journals.publisher_tbl publisher ON publisher.publisher_id=source.publisher_id WHERE COALESCE(source.active,1)=1 AND COALESCE(publisher.active,1)=1 ${inactivePublisherGuard} AND (source.journal_title LIKE ${`%${q}%`} OR source.abbreviation LIKE ${`%${q}%`}) ORDER BY value LIMIT 8`);
    return res.json({ suggestions: fallback.map((row) => row.value) });
  } catch (error) {
    next(error);
  }
});
app.get("/api/indexing/authors/suggestions", async (req, res, next) => {
  try {
    const { q } = z.object({ q: z.string().trim().min(2).max(150) }).parse(req.query);
    const rows = await prisma.$queryRaw<Array<{ name: string }>>(
      Prisma.sql`SELECT DISTINCT TRIM(profile.author_name) name
        FROM ijpass_journals.author_profile_tbl profile
        INNER JOIN ijpass_journals.manuscript_author_tbl authorship
          ON authorship.author_profile_id = profile.author_profile_id
        INNER JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.manuscript_id = authorship.manuscript_id
        INNER JOIN ijpass_journals.sourcedata_tbl visible_source
          ON visible_source.source_data_id = manuscript.journal_id
        LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
          ON visible_publisher.publisher_id = visible_source.publisher_id
        WHERE LOWER(profile.author_name) LIKE LOWER(${`%${q}%`})
          AND COALESCE(visible_source.active,1)=1
          AND COALESCE(visible_publisher.active,1)=1
          ${inactiveVisiblePublisherGuard}
        ORDER BY name LIMIT 8`,
    );
    return res.json({ suggestions: rows.map((row) => row.name) });
  } catch (error) {
    next(error);
  }
});

const authorMergeSelectionSchema = z.object({
  authorIds: z.array(z.coerce.number().int().positive()).min(2).max(20),
});
const authorMergeApprovalSchema = authorMergeSelectionSchema.extend({
  canonicalAuthorId: z.coerce.number().int().positive(),
});
const normalizeMergeName = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const parseAuthorIds = (value: unknown): number[] => {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? [...new Set(parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b)
    : [];
};
type AuthorAffiliationPeriod = {
  authorId: bigint;
  affiliationId: bigint;
  affiliation: string;
  country: string | null;
  department: string | null;
  designation: string | null;
  startYear: number | null;
  endYear: number | null;
  papers: bigint;
};
const affiliationIdentity = (value: string) => {
  const cleanName = value.trim().replace(/^,+\s*/, "").replace(/\s+/g, " ") || "Affiliation unavailable";
  return cleanName.split(",")[0].trim().normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
};
const consolidateAuthorAffiliations = (rows: AuthorAffiliationPeriod[]) => {
  const grouped = new Map<string, {
    id: number;
    name: string;
    country: string | null;
    department: string | null;
    designation: string | null;
    designations: string[];
    startYear: number | null;
    endYear: number | null;
    papers: number;
  }>();
  for (const row of rows) {
    const cleanName = row.affiliation.trim().replace(/^,+\s*/, "").replace(/\s+/g, " ") || "Affiliation unavailable";
    const key = affiliationIdentity(cleanName);
    const cleanCountry = row.country?.trim().replace(/[.,]+$/, "") || null;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        id: Number(row.affiliationId),
        name: cleanName,
        country: cleanCountry,
        department: row.department?.trim() || null,
        designation: row.designation?.trim() || null,
        designations: row.designation?.trim() ? [row.designation.trim()] : [],
        startYear: row.startYear,
        endYear: row.endYear,
        papers: Number(row.papers),
      });
      continue;
    }
    if (cleanName.length > current.name.length) {
      current.name = cleanName;
      current.id = Number(row.affiliationId);
    }
    current.country ||= cleanCountry;
    current.department ||= row.department?.trim() || null;
    current.designation ||= row.designation?.trim() || null;
    if (row.designation?.trim() && !current.designations.includes(row.designation.trim()))
      current.designations.push(row.designation.trim());
    if (row.startYear && (!current.startYear || row.startYear < current.startYear)) current.startYear = row.startYear;
    if (row.endYear && (!current.endYear || row.endYear > current.endYear)) current.endYear = row.endYear;
    current.papers += Number(row.papers);
  }
  return [...grouped.values()].sort((first, second) => first.name.localeCompare(second.name));
};
const getMergeAuthorProfiles = async (authorIds: number[]) => {
  if (!authorIds.length) return [];
  const [profiles, publicationAffiliations, linkedAffiliations] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: bigint;
      salutation: string | null;
      name: string;
      email: string | null;
      orcid: string | null;
      createdAt: Date;
      papers: bigint;
    }>>(Prisma.sql`
      SELECT profile.author_profile_id id,profile.salutation,profile.author_name name,
        profile.email,profile.orcid,profile.created_at createdAt,
        COUNT(DISTINCT authorship.manuscript_id) papers
      FROM ijpass_journals.author_profile_tbl profile
      LEFT JOIN ijpass_journals.manuscript_author_tbl authorship
        ON authorship.author_profile_id=profile.author_profile_id
      WHERE profile.author_profile_id IN (${Prisma.join(authorIds)})
      GROUP BY profile.author_profile_id,profile.salutation,profile.author_name,
        profile.email,profile.orcid,profile.created_at
      ORDER BY profile.author_profile_id`),
    prisma.$queryRaw<Array<AuthorAffiliationPeriod>>(Prisma.sql`
      SELECT authorship.author_profile_id authorId,MIN(source_author.author_data_id) affiliationId,
        TRIM(source_author.university_company) affiliation,source_author.country,
        NULL department,source_author.department_designation designation,
        MIN(manuscript.publication_year) startYear,MAX(manuscript.publication_year) endYear,
        COUNT(DISTINCT manuscript.manuscript_id) papers
      FROM ijpass_journals.manuscript_author_tbl authorship
      INNER JOIN ijpass_journals.authordata_tbl source_author
        ON source_author.author_data_id=authorship.author_data_id
      INNER JOIN ijpass_journals.manuscript_tbl manuscript
        ON manuscript.manuscript_id=authorship.manuscript_id
      WHERE authorship.author_profile_id IN (${Prisma.join(authorIds)})
        AND TRIM(COALESCE(source_author.university_company,''))<>''
      GROUP BY authorship.author_profile_id,source_author.university_company,source_author.country,
        source_author.department_designation
      ORDER BY authorship.author_profile_id,source_author.university_company`),
    prisma.$queryRaw<Array<AuthorAffiliationPeriod>>(Prisma.sql`
      SELECT link.author_profile_id authorId,affiliation.affiliation_id affiliationId,
        TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)) affiliation,
        affiliation.country,NULL department,NULL designation,
        COALESCE(link.start_year,MIN(manuscript.publication_year)) startYear,
        COALESCE(link.end_year,MAX(manuscript.publication_year)) endYear,
        COUNT(DISTINCT manuscript.manuscript_id) papers
      FROM ijpass_journals.author_affiliation_tbl link
      INNER JOIN ijpass_journals.affiliationdata_tbl affiliation
        ON affiliation.affiliation_id=link.affiliation_id
      LEFT JOIN ijpass_journals.manuscript_author_tbl authorship
        ON authorship.author_profile_id=link.author_profile_id
      LEFT JOIN ijpass_journals.manuscript_tbl manuscript
        ON manuscript.manuscript_id=authorship.manuscript_id
      WHERE link.author_profile_id IN (${Prisma.join(authorIds)})
      GROUP BY link.author_profile_id,affiliation.affiliation_id,affiliation.university_company,
        affiliation.country,link.start_year,link.end_year
      ORDER BY link.author_profile_id,affiliation.university_company`),
  ]);
  return profiles.map((profile) => {
    const publishedRows = publicationAffiliations.filter((item) => Number(item.authorId) === Number(profile.id));
    const linkedRows = linkedAffiliations.filter((item) => Number(item.authorId) === Number(profile.id));
    const linkedGroups = consolidateAuthorAffiliations(linkedRows);
    const publishedGroups = consolidateAuthorAffiliations(publishedRows);
    const affiliationRows = publishedGroups.length
      ? [
          ...publishedGroups.map((published) => {
            const linked = linkedGroups.find((item) => affiliationIdentity(item.name) === affiliationIdentity(published.name));
            return linked ? {
              ...published,
              id: linked.id,
              name: published.name.length >= linked.name.length ? published.name : linked.name,
              department: linked.department || published.department,
              designation: linked.designation || published.designation,
              designations: [...new Set([...linked.designations, ...published.designations])],
            } : published;
          }),
          ...linkedGroups.filter((linked) => !publishedGroups.some((published) => affiliationIdentity(published.name) === affiliationIdentity(linked.name))),
        ]
      : linkedGroups;
    return {
    id: Number(profile.id),
    salutation: profile.salutation,
    name: profile.name,
    email: profile.email,
    orcid: profile.orcid,
    createdAt: profile.createdAt,
    papers: Number(profile.papers),
    affiliations: affiliationRows,
  };
  });
};

app.post("/api/indexing/authors/merge-requests", async (req, res, next) => {
  try {
    const input = authorMergeSelectionSchema.parse(req.body),
      authorIds = [...new Set(input.authorIds)].sort((a, b) => a - b);
    if (authorIds.length < 2)
      return res.status(400).json({ message: "Select at least two different author profiles." });
    const profiles = await getMergeAuthorProfiles(authorIds);
    if (profiles.length !== authorIds.length)
      return res.status(400).json({ message: "One or more selected author profiles no longer exist." });
    const names = new Set(profiles.map((profile) => normalizeMergeName(profile.name)));
    if (names.size !== 1)
      return res.status(400).json({ message: "Only profiles with the same author name can be included in one merge request." });
    const pending = await prisma.$queryRaw<Array<{ reference: string; authorIds: unknown }>>(
      Prisma.sql`SELECT reference,authorIds FROM AuthorMergeRequest WHERE status='PENDING'`,
    );
    const duplicateRequest = pending.find((item) => JSON.stringify(parseAuthorIds(item.authorIds)) === JSON.stringify(authorIds));
    if (duplicateRequest)
      return res.status(409).json({ message: `This merge request is already pending. Reference: ${duplicateRequest.reference}` });
    const reference = `AMR-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO AuthorMergeRequest(reference,requestedName,authorIds,status,createdAt)
      VALUES(${reference},${profiles[0].name},${JSON.stringify(authorIds)},'PENDING',NOW())`);
    return res.status(201).json({
      message: "Author merge request submitted for Super Admin review.",
      reference,
    });
  } catch (error) {
    next(error);
  }
});

const affiliationMergeSelectionSchema = z.object({
  affiliationIds: z.array(z.coerce.number().int().positive()).min(2).max(20),
});
const affiliationMergeApprovalSchema = affiliationMergeSelectionSchema.extend({
  canonicalAffiliationId: z.coerce.number().int().positive(),
});
const getMergeAffiliationProfiles = async (affiliationIds: number[]) => {
  if (!affiliationIds.length) return [];
  const records = await prisma.$queryRaw<Array<{
    id: bigint;
    name: string;
    address: string;
    country: string;
    authors: bigint;
    papers: bigint;
  }>>(Prisma.sql`
    SELECT affiliation.affiliation_id id,affiliation.university_company name,
      affiliation.address,affiliation.country,
      COUNT(DISTINCT authorship.author_profile_id) authors,
      COUNT(DISTINCT authorship.manuscript_id) papers
    FROM ijpass_journals.affiliationdata_tbl affiliation
    LEFT JOIN ijpass_journals.authordata_tbl source_author
      ON LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company)))=
         LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)))
    LEFT JOIN ijpass_journals.manuscript_author_tbl authorship
      ON authorship.author_data_id=source_author.author_data_id
    WHERE affiliation.affiliation_id IN (${Prisma.join(affiliationIds)})
    GROUP BY affiliation.affiliation_id,affiliation.university_company,affiliation.address,affiliation.country
    ORDER BY affiliation.affiliation_id`);
  return records.map((record) => ({ ...record, id: Number(record.id), authors: Number(record.authors), papers: Number(record.papers) }));
};

app.post("/api/indexing/affiliations/merge-requests", async (req, res, next) => {
  try {
    const input = affiliationMergeSelectionSchema.parse(req.body),
      affiliationIds = [...new Set(input.affiliationIds)].sort((a, b) => a - b);
    const profiles = await getMergeAffiliationProfiles(affiliationIds);
    if (profiles.length !== affiliationIds.length)
      return res.status(400).json({ message: "One or more selected affiliation profiles no longer exist." });
    const pending = await prisma.$queryRaw<Array<{ reference: string; affiliationIds: unknown }>>(
      Prisma.sql`SELECT reference,affiliationIds FROM AffiliationMergeRequest WHERE status='PENDING'`,
    );
    const duplicate = pending.find((item) => JSON.stringify(parseAuthorIds(item.affiliationIds)) === JSON.stringify(affiliationIds));
    if (duplicate)
      return res.status(409).json({ message: `This affiliation merge request is already pending. Reference: ${duplicate.reference}` });
    const reference = `FMR-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO AffiliationMergeRequest(reference,requestedName,affiliationIds,status,createdAt)
      VALUES(${reference},${profiles[0].name},${JSON.stringify(affiliationIds)},'PENDING',NOW())`);
    return res.status(201).json({ message: "Affiliation merge request submitted for Super Admin review.", reference });
  } catch (error) {
    next(error);
  }
});

const publicIndexQuery = z.object({
  q: z.string().trim().max(200).catch(""),
  page: z.coerce.number().int().positive().catch(1),
});

const inactivePublisherGuard = Prisma.sql`
  AND NOT EXISTS (
    SELECT 1
    FROM ijpass_journals.publisher_tbl inactive_publisher
    WHERE COALESCE(inactive_publisher.active, 1) = 0
      AND (
        inactive_publisher.publisher_id = source.publisher_id
        OR TRIM(inactive_publisher.publisher_name) = TRIM(COALESCE(publisher.publisher_name, source.publisher))
      )
  )
`;

const inactiveVisiblePublisherGuard = Prisma.sql`
  AND NOT EXISTS (
    SELECT 1
    FROM ijpass_journals.publisher_tbl inactive_publisher
    WHERE COALESCE(inactive_publisher.active, 1) = 0
      AND (
        inactive_publisher.publisher_id = visible_source.publisher_id
        OR TRIM(inactive_publisher.publisher_name) = TRIM(COALESCE(visible_publisher.publisher_name, visible_source.publisher))
      )
  )
`;

const affiliationNameMatch = Prisma.sql`
  LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company))) IN (
    LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company))),
    LOWER(TRIM(LEADING ', ' FROM TRIM(CONCAT_WS(', ', affiliation.university_company, NULLIF(TRIM(COALESCE(affiliation.city_territory,'')),'')))))
  )
`;

app.get("/api/indexing/resources", async (req, res, next) => {
  try {
  const previousYear = new Date().getFullYear();
    const input = publicIndexQuery
        .extend({
          field: z
            .enum(["resourceTitle", "subject", "publisher", "manuscriptTitle"])
            .catch("resourceTitle"),
          types: z.string().trim().max(200).catch(""),
          year: z.coerce
            .number()
            .int()
            .min(1900)
            .max(previousYear)
            .catch(previousYear),
          publicationYear: z.coerce.number().int().min(1900).max(previousYear).optional().catch(undefined),
        })
        .parse(req.query),
      pageSize = 20,
      types = input.types
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      startYear = input.year - 2;
    const elasticFields = {
        resourceTitle: ["abbreviation^6", "title^3"],
        subject: ["subject^3", "title"],
        publisher: ["publisher^3", "title"],
        manuscriptTitle: ["manuscriptTitles^3", "title"],
      }[input.field],
      elasticIds = input.q
      ? await searchIndexIds("ijpass-resources", input.q, elasticFields)
        : null;
    const search = !input.q
      ? Prisma.empty
      : elasticIds?.length
        ? Prisma.sql`AND source.source_data_id IN (${Prisma.join(elasticIds.map(Number))})`
        : input.field === "subject"
          ? Prisma.sql`AND source.subject_area LIKE ${`%${input.q}%`}`
          : input.field === "publisher"
            ? Prisma.sql`AND COALESCE(publisher.publisher_name,source.publisher) LIKE ${`%${input.q}%`} AND COALESCE(publisher.active,1)=1`
            : input.field === "manuscriptTitle"
              ? Prisma.sql`AND EXISTS(SELECT 1 FROM ijpass_journals.manuscript_tbl searched_manuscript WHERE searched_manuscript.journal_id=source.source_data_id AND searched_manuscript.article_title LIKE ${`%${input.q}%`})`
              : Prisma.sql`AND (source.journal_title LIKE ${`%${input.q}%`} OR source.abbreviation LIKE ${`%${input.q}%`})`;
    const typeFilter = types.length
      ? Prisma.sql`AND COALESCE(source.source_type,'Journal') IN (${Prisma.join(types)})`
      : Prisma.empty;
    const publicationYearFilter = input.publicationYear
      ? Prisma.sql`AND EXISTS(SELECT 1 FROM ijpass_journals.manuscript_tbl year_manuscript WHERE year_manuscript.journal_id=source.source_data_id AND year_manuscript.publication_year=${input.publicationYear})`
      : Prisma.empty;
    const [sourceRows, metricMap] = await Promise.all([
      prisma.$queryRaw<Array<{ id: bigint; title: string; abbreviation: string | null; publisher: string | null }>>(
        Prisma.sql`SELECT source.source_data_id id,TRIM(source.journal_title) title,TRIM(source.abbreviation) abbreviation,COALESCE(publisher.publisher_name,source.publisher) publisher FROM ijpass_journals.sourcedata_tbl source LEFT JOIN ijpass_journals.publisher_tbl publisher ON publisher.publisher_id=source.publisher_id WHERE COALESCE(source.active,1)=1 AND COALESCE(publisher.active,1)=1 ${inactivePublisherGuard} ${search} ${typeFilter} ${publicationYearFilter}`,
      ),
      getResourceMetrics(prisma, input.year),
    ]);
    const allRecords = sourceRows.map((source) => ({
      id: Number(source.id),
      title: source.title,
      abbreviation: source.abbreviation,
      publisher: source.publisher,
      ...(metricMap.get(Number(source.id)) ?? { citeMetrixScore: 0, percentile: 0, citations: 0, papers: 0, citedPercent: 0, hIndex: 0, i10Index: 0 }),
    }));
    allRecords.sort((a, b) => b.citeMetrixScore - a.citeMetrixScore || a.title.localeCompare(b.title));
    const totalRecords = allRecords.length,
      totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
      page = Math.min(input.page, totalPages),
      offset = (page - 1) * pageSize,
      records = allRecords.slice(offset, offset + pageSize);
    res.set("Cache-Control", "public, max-age=120");
    return res.json({
      resources: records,
      metricYear: input.year,
      metricStartYear: startYear,
      pagination: { page, pageSize, totalRecords, totalPages },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/indexing/authors", async (req, res, next) => {
  try {
    const input = publicIndexQuery.extend({ country: z.string().trim().max(100).catch("") }).parse(req.query),
      pageSize = 20;
    const conditions: Prisma.Sql[] = [];
    const elasticIds = input.q ? await searchAuthorIds(input.q) : null;
    if (input.q) {
      if (elasticIds?.length) conditions.push(Prisma.sql`profile.author_profile_id IN (${Prisma.join(elasticIds.map(Number))})`);
      else conditions.push(Prisma.sql`(LOWER(profile.author_name) LIKE LOWER(${`%${input.q}%`}) OR LOWER(CONCAT_WS(' ',profile.salutation,profile.author_name)) LIKE LOWER(${`%${input.q}%`}))`);
    }
    if (input.country) conditions.push(Prisma.sql`LOWER(TRIM(affiliation.country))=LOWER(${input.country})`);
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.sql`WHERE 1=1`;
    const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT COUNT(DISTINCT profile.author_profile_id) total FROM ijpass_journals.author_profile_tbl profile LEFT JOIN ijpass_journals.author_affiliation_tbl link ON link.author_profile_id=profile.author_profile_id AND link.is_current=1 LEFT JOIN ijpass_journals.affiliationdata_tbl affiliation ON affiliation.affiliation_id=link.affiliation_id INNER JOIN ijpass_journals.manuscript_author_tbl authorship ON authorship.author_profile_id=profile.author_profile_id INNER JOIN ijpass_journals.manuscript_tbl manuscript ON manuscript.manuscript_id=authorship.manuscript_id INNER JOIN ijpass_journals.sourcedata_tbl visible_source ON visible_source.source_data_id=manuscript.journal_id LEFT JOIN ijpass_journals.publisher_tbl visible_publisher ON visible_publisher.publisher_id=visible_source.publisher_id ${where} AND COALESCE(visible_source.active,1)=1 AND COALESCE(visible_publisher.active,1)=1 ${inactiveVisiblePublisherGuard}`,
    );
    const totalRecords = Number(total),
      totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
      page = Math.min(input.page, totalPages),
      offset = (page - 1) * pageSize;
    const records = await prisma.$queryRaw<
      Array<{
        id: bigint;
        salutation: string | null;
        name: string;
        orcid: string | null;
        affiliation: string | null;
        country: string | null;
        papers: bigint;
      }>
    >(
      Prisma.sql`SELECT profile.author_profile_id id,profile.salutation,profile.author_name name,profile.orcid,MAX(affiliation.university_company) affiliation,MAX(affiliation.country) country,COUNT(DISTINCT authorship.manuscript_id) papers FROM ijpass_journals.author_profile_tbl profile LEFT JOIN ijpass_journals.author_affiliation_tbl link ON link.author_profile_id=profile.author_profile_id AND link.is_current=1 LEFT JOIN ijpass_journals.affiliationdata_tbl affiliation ON affiliation.affiliation_id=link.affiliation_id INNER JOIN ijpass_journals.manuscript_author_tbl authorship ON authorship.author_profile_id=profile.author_profile_id INNER JOIN ijpass_journals.manuscript_tbl manuscript ON manuscript.manuscript_id=authorship.manuscript_id INNER JOIN ijpass_journals.sourcedata_tbl visible_source ON visible_source.source_data_id=manuscript.journal_id LEFT JOIN ijpass_journals.publisher_tbl visible_publisher ON visible_publisher.publisher_id=visible_source.publisher_id ${where} AND COALESCE(visible_source.active,1)=1 AND COALESCE(visible_publisher.active,1)=1 ${inactiveVisiblePublisherGuard} GROUP BY profile.author_profile_id,profile.salutation,profile.author_name,profile.orcid ORDER BY profile.author_name LIMIT ${pageSize} OFFSET ${offset}`,
    );
    const recordIds = records.map((record) => Number(record.id));
    const [citationRows, authorDetails] = records.length ? await Promise.all([
      prisma.$queryRaw<Array<{ authorId: bigint; manuscriptId: bigint; citations: bigint }>>(
        Prisma.sql`SELECT authorship.author_profile_id authorId,manuscript.manuscript_id manuscriptId,COUNT(DISTINCT ref.reference_id) citations FROM ijpass_journals.manuscript_author_tbl authorship INNER JOIN ijpass_journals.manuscript_tbl manuscript ON manuscript.manuscript_id=authorship.manuscript_id INNER JOIN ijpass_journals.sourcedata_tbl visible_source ON visible_source.source_data_id=manuscript.journal_id LEFT JOIN ijpass_journals.publisher_tbl visible_publisher ON visible_publisher.publisher_id=visible_source.publisher_id LEFT JOIN ijpass_journals.refdat_table ref ON ref.publication_year=manuscript.publication_year AND LOWER(TRIM(ref.article_title))=LOWER(TRIM(manuscript.article_title)) AND ref.manuscript_id<>manuscript.manuscript_id WHERE authorship.author_profile_id IN (${Prisma.join(recordIds)}) AND COALESCE(visible_source.active,1)=1 AND COALESCE(visible_publisher.active,1)=1 ${inactiveVisiblePublisherGuard} GROUP BY authorship.author_profile_id,manuscript.manuscript_id`,
      ),
      getMergeAuthorProfiles(recordIds),
    ]) : [[], []];
    const metrics = new Map<number, { hIndex: number; i10Index: number }>();
    for (const record of records) {
      const counts = citationRows.filter((row) => Number(row.authorId) === Number(record.id)).map((row) => Number(row.citations)).sort((a, b) => b - a);
      let hIndex = 0;
      counts.forEach((count, index) => { if (count >= index + 1) hIndex = index + 1; });
      metrics.set(Number(record.id), { hIndex, i10Index: counts.filter((count) => count >= 10).length });
    }
    return res.json({
      authors: records.map((record) => ({
        ...record,
        id: Number(record.id),
        papers: Number(record.papers),
        affiliations: authorDetails.find((profile) => profile.id === Number(record.id))?.affiliations ?? [],
        ...(metrics.get(Number(record.id)) ?? { hIndex: 0, i10Index: 0 }),
      })),
      pagination: { page, pageSize, totalRecords, totalPages },
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/indexing/authors/:id", async (req, res, next) => {
  try {
    const authorId = z.coerce.number().int().positive().parse(req.params.id);
    const { page: requestedPage, sort } = z.object({
      page: z.coerce.number().int().positive().catch(1),
      sort: z.enum(["year", "papers", "citations"]).catch("citations"),
    }).parse(req.query);
    const [author] = await getMergeAuthorProfiles([authorId]);
    if (!author) return res.status(404).json({ message: "Author profile not found." });
    const pageSize = 20;
    const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT manuscript.manuscript_id) total
      FROM ijpass_journals.manuscript_author_tbl authorship
      INNER JOIN ijpass_journals.manuscript_tbl manuscript
        ON manuscript.manuscript_id=authorship.manuscript_id
      INNER JOIN ijpass_journals.sourcedata_tbl visible_source
        ON visible_source.source_data_id=manuscript.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
        ON visible_publisher.publisher_id=visible_source.publisher_id
      WHERE authorship.author_profile_id=${authorId}
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}`);
    const totalRecords = Number(total);
    if (!totalRecords) return res.status(404).json({ message: "Author profile not found." });
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    const paperOrder = sort === "citations"
      ? Prisma.sql`citationCount DESC,manuscript.publication_year DESC,manuscript.manuscript_id DESC`
      : sort === "papers"
        ? Prisma.sql`manuscript.manuscript_id DESC`
        : Prisma.sql`manuscript.publication_year DESC,manuscript.manuscript_id DESC`;
    const papers = await prisma.$queryRaw<Array<{
      id: bigint;
      title: string;
      sourceId: bigint;
      sourceTitle: string;
      volume: string | null;
      issue: string | null;
      pages: string | null;
      publicationYear: number | null;
      doi: string | null;
      citationCount: bigint;
    }>>(Prisma.sql`
      SELECT manuscript.manuscript_id id,manuscript.article_title title,
        source.source_data_id sourceId,source.journal_title sourceTitle,
        manuscript.volume,manuscript.issue,manuscript.pages,
        manuscript.publication_year publicationYear,manuscript.doi,
        (SELECT COUNT(DISTINCT ranking_reference.reference_id)
          FROM ijpass_journals.refdat_table ranking_reference
          WHERE ranking_reference.publication_year=manuscript.publication_year
            AND LOWER(TRIM(ranking_reference.article_title))=LOWER(TRIM(manuscript.article_title))
            AND ranking_reference.manuscript_id<>manuscript.manuscript_id) citationCount
      FROM ijpass_journals.manuscript_author_tbl authorship
      INNER JOIN ijpass_journals.manuscript_tbl manuscript
        ON manuscript.manuscript_id=authorship.manuscript_id
      INNER JOIN ijpass_journals.sourcedata_tbl visible_source
        ON visible_source.source_data_id=manuscript.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
        ON visible_publisher.publisher_id=visible_source.publisher_id
      INNER JOIN ijpass_journals.sourcedata_tbl source
        ON source.source_data_id=manuscript.journal_id
      WHERE authorship.author_profile_id=${authorId}
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}
      GROUP BY manuscript.manuscript_id,manuscript.article_title,
        source.source_data_id,source.journal_title,manuscript.volume,
        manuscript.issue,manuscript.pages,manuscript.publication_year,manuscript.doi
      ORDER BY ${paperOrder}
      LIMIT ${pageSize} OFFSET ${offset}`);
    const paperIds = papers.map((paper) => Number(paper.id));
    const paperAuthorRows = paperIds.length ? await prisma.$queryRaw<Array<{
      manuscriptId: bigint;
      profileId: bigint | null;
      salutation: string | null;
      name: string;
    }>>(Prisma.sql`
      SELECT authorship.manuscript_id manuscriptId,authorship.author_profile_id profileId,
        profile.salutation,COALESCE(profile.author_name,source_author.author_name) name
      FROM ijpass_journals.manuscript_author_tbl authorship
      INNER JOIN ijpass_journals.manuscript_tbl manuscript
        ON manuscript.manuscript_id=authorship.manuscript_id
      INNER JOIN ijpass_journals.sourcedata_tbl visible_source
        ON visible_source.source_data_id=manuscript.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
        ON visible_publisher.publisher_id=visible_source.publisher_id
      LEFT JOIN ijpass_journals.author_profile_tbl profile
        ON profile.author_profile_id=authorship.author_profile_id
      LEFT JOIN ijpass_journals.authordata_tbl source_author
        ON source_author.author_data_id=authorship.author_data_id
      WHERE authorship.manuscript_id IN (${Prisma.join(paperIds)})
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}
        AND COALESCE(profile.author_name,source_author.author_name) IS NOT NULL
      ORDER BY authorship.manuscript_id,authorship.author_order`) : [];
    const [citationRows, collaboratorRows, researchAreaRows] = await Promise.all([
      prisma.$queryRaw<Array<{ manuscriptId: bigint; title: string; publicationYear: number | null; citations: bigint }>>(Prisma.sql`
      SELECT manuscript.manuscript_id manuscriptId,manuscript.article_title title,manuscript.publication_year publicationYear,
        COUNT(DISTINCT reference.reference_id) citations
      FROM ijpass_journals.manuscript_author_tbl authorship
      INNER JOIN ijpass_journals.manuscript_tbl manuscript
        ON manuscript.manuscript_id=authorship.manuscript_id
      INNER JOIN ijpass_journals.sourcedata_tbl visible_source
        ON visible_source.source_data_id=manuscript.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
        ON visible_publisher.publisher_id=visible_source.publisher_id
      LEFT JOIN ijpass_journals.refdat_table reference
        ON reference.publication_year=manuscript.publication_year
        AND LOWER(TRIM(reference.article_title))=LOWER(TRIM(manuscript.article_title))
        AND reference.manuscript_id<>manuscript.manuscript_id
      WHERE authorship.author_profile_id=${authorId}
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}
      GROUP BY manuscript.manuscript_id,manuscript.article_title,manuscript.publication_year`),
      prisma.$queryRaw<Array<{ id: bigint; salutation: string | null; name: string; papers: bigint }>>(Prisma.sql`
        SELECT collaborator.author_profile_id id,profile.salutation,profile.author_name name,
          COUNT(DISTINCT collaborator.manuscript_id) papers
        FROM ijpass_journals.manuscript_author_tbl author_link
        INNER JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.manuscript_id=author_link.manuscript_id
        INNER JOIN ijpass_journals.sourcedata_tbl visible_source
          ON visible_source.source_data_id=manuscript.journal_id
        LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
          ON visible_publisher.publisher_id=visible_source.publisher_id
        INNER JOIN ijpass_journals.manuscript_author_tbl collaborator
          ON collaborator.manuscript_id=author_link.manuscript_id
          AND collaborator.author_profile_id IS NOT NULL
          AND collaborator.author_profile_id<>${authorId}
        INNER JOIN ijpass_journals.author_profile_tbl profile
          ON profile.author_profile_id=collaborator.author_profile_id
        WHERE author_link.author_profile_id=${authorId}
          AND COALESCE(visible_source.active,1)=1
          AND COALESCE(visible_publisher.active,1)=1
          ${inactiveVisiblePublisherGuard}
        GROUP BY collaborator.author_profile_id,profile.salutation,profile.author_name
        ORDER BY papers DESC,profile.author_name ASC
        LIMIT 12`),
      prisma.$queryRaw<Array<{ subjectArea: string | null; keywords: string | null }>>(Prisma.sql`
        SELECT source.subject_area subjectArea,manuscript.keywords
        FROM ijpass_journals.manuscript_author_tbl authorship
        INNER JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.manuscript_id=authorship.manuscript_id
        INNER JOIN ijpass_journals.sourcedata_tbl source
          ON source.source_data_id=manuscript.journal_id
        LEFT JOIN ijpass_journals.publisher_tbl publisher
          ON publisher.publisher_id=source.publisher_id
        WHERE authorship.author_profile_id=${authorId}
          AND COALESCE(source.active,1)=1
          AND COALESCE(publisher.active,1)=1
          ${inactivePublisherGuard}
        GROUP BY manuscript.manuscript_id,source.subject_area,manuscript.keywords`),
    ]);
    const citationCounts = citationRows.map((row) => Number(row.citations)).sort((first, second) => second - first);
    const paperCitations = new Map(citationRows.map((row) => [Number(row.manuscriptId), Number(row.citations)]));
    const yearlyMap = new Map<number, { papers: number; citations: number }>();
    for (const row of citationRows) {
      if (!row.publicationYear) continue;
      const current = yearlyMap.get(row.publicationYear) ?? { papers: 0, citations: 0 };
      current.papers += 1;
      current.citations += Number(row.citations);
      yearlyMap.set(row.publicationYear, current);
    }
    const yearlyTrend = [...yearlyMap.entries()]
      .map(([year, metrics]) => ({ year, ...metrics }))
      .sort((first, second) => first.year - second.year);
    const metricYear = new Date().getFullYear();
    const metricStartYear = metricYear - 2;
    const metricRows = citationRows.filter((row) => row.publicationYear && row.publicationYear >= metricStartYear && row.publicationYear <= metricYear);
    const citeMetrixPapers = metricRows.length;
    const citeMetrixCitations = metricRows.reduce((total, row) => total + Number(row.citations), 0);
    const researchAreaMap = new Map<string, { name: string; papers: number }>();
    for (const row of researchAreaRows) {
      const sourceValues = row.subjectArea?.split(/[;,|]/).map((value) => value.trim()).filter(Boolean) ?? [];
      const values = sourceValues.length
        ? sourceValues
        : row.keywords?.split(/[;,|]/).map((value) => value.trim()).filter((value) => value.length >= 3) ?? [];
      for (const value of new Set(values)) {
        const key = value.toLocaleLowerCase();
        const current = researchAreaMap.get(key) ?? { name: value, papers: 0 };
        current.papers += 1;
        researchAreaMap.set(key, current);
      }
    }
    const researchAreas = [...researchAreaMap.values()]
      .sort((first, second) => second.papers - first.papers || first.name.localeCompare(second.name))
      .slice(0, 12);
    let hIndex = 0;
    citationCounts.forEach((count, index) => {
      if (count >= index + 1) hIndex = index + 1;
    });
    const hGraph = [...citationRows]
      .sort((first, second) => Number(second.citations) - Number(first.citations) || first.title.localeCompare(second.title))
      .map((row, index) => ({
        manuscriptId: Number(row.manuscriptId),
        title: row.title,
        rank: index + 1,
        citations: Number(row.citations),
        qualifies: Number(row.citations) >= index + 1,
      }));
    return res.json({
      author: {
        id: author.id,
        salutation: author.salutation,
        name: author.name,
        papers: author.papers,
        citations: citationCounts.reduce((sum, count) => sum + count, 0),
        hIndex,
        i10Index: citationCounts.filter((count) => count >= 10).length,
        affiliations: author.affiliations,
      },
      papers: papers.map(({ citationCount: _citationCount, ...paper }) => ({
        ...paper,
        id: Number(paper.id),
        sourceId: Number(paper.sourceId),
        citations: paperCitations.get(Number(paper.id)) ?? 0,
        authors: paperAuthorRows
          .filter((row) => Number(row.manuscriptId) === Number(paper.id))
          .map((row) => ({
            profileId: row.profileId ? Number(row.profileId) : null,
            name: [row.salutation, row.name].filter(Boolean).join(" "),
          })),
      })),
      analytics: {
        yearlyTrend,
        hGraph,
        citeMetrix: {
          startYear: metricStartYear,
          endYear: metricYear,
          papers: citeMetrixPapers,
          citations: citeMetrixCitations,
          score: citeMetrixPapers ? Number((citeMetrixCitations / citeMetrixPapers).toFixed(2)) : 0,
        },
        collaborators: collaboratorRows.map((row) => ({
          id: Number(row.id),
          salutation: row.salutation,
          name: row.name,
          papers: Number(row.papers),
        })),
        researchAreas,
      },
      pagination: { page, pageSize, totalRecords, totalPages },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/indexing/affiliations/suggestions", async (req, res, next) => {
  try {
    const { q } = z.object({ q: z.string().trim().min(2).max(200) }).parse(req.query),
      elasticIds = await searchIndexIds("ijpass-affiliations", q, ["name^3", "cityTerritory^2", "address", "country^2"]),
      where = elasticIds !== null
        ? elasticIds.length
          ? Prisma.sql`WHERE affiliation.affiliation_id IN (${Prisma.join(elasticIds.map(Number))}) AND affiliation.university_company LIKE ${`%${q}%`}`
          : Prisma.sql`WHERE 1=0`
        : Prisma.sql`WHERE affiliation.university_company LIKE ${`%${q}%`}`;
    let rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT matches.name
      FROM (
        SELECT DISTINCT TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)) name
        FROM ijpass_journals.affiliationdata_tbl affiliation
        INNER JOIN ijpass_journals.authordata_tbl source_author
          ON ${affiliationNameMatch}
        INNER JOIN ijpass_journals.manuscript_author_tbl authorship
          ON authorship.author_data_id=source_author.author_data_id
        INNER JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.manuscript_id=authorship.manuscript_id
        INNER JOIN ijpass_journals.sourcedata_tbl visible_source
          ON visible_source.source_data_id=manuscript.journal_id
        LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
          ON visible_publisher.publisher_id=visible_source.publisher_id
        ${where}
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}
      ) matches
      ORDER BY CASE WHEN matches.name LIKE ${`${q}%`} THEN 0 ELSE 1 END,matches.name
      LIMIT 8`);
    if (!rows.length && elasticIds !== null)
      rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
        SELECT matches.name
        FROM (
          SELECT DISTINCT TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)) name
          FROM ijpass_journals.affiliationdata_tbl affiliation
          INNER JOIN ijpass_journals.authordata_tbl source_author
            ON ${affiliationNameMatch}
          INNER JOIN ijpass_journals.manuscript_author_tbl authorship
            ON authorship.author_data_id=source_author.author_data_id
          INNER JOIN ijpass_journals.manuscript_tbl manuscript
            ON manuscript.manuscript_id=authorship.manuscript_id
          INNER JOIN ijpass_journals.sourcedata_tbl visible_source
            ON visible_source.source_data_id=manuscript.journal_id
          LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
            ON visible_publisher.publisher_id=visible_source.publisher_id
          WHERE affiliation.university_company LIKE ${`%${q}%`}
            AND COALESCE(visible_source.active,1)=1
            AND COALESCE(visible_publisher.active,1)=1
            ${inactiveVisiblePublisherGuard}
        ) matches
        ORDER BY CASE WHEN matches.name LIKE ${`${q}%`} THEN 0 ELSE 1 END,matches.name
        LIMIT 8`);
    return res.json({ suggestions: rows.map((row) => row.name) });
  } catch (error) { next(error); }
});
app.get("/api/indexing/affiliations", async (req, res, next) => {
  try {
    const input = publicIndexQuery.parse(req.query),
      pageSize = 20;
    const elasticIds = input.q
      ? await searchIndexIds("ijpass-affiliations", input.q, ["name^3", "cityTerritory^2", "address", "country^2"])
      : null;
    const where = !input.q
      ? Prisma.sql`WHERE 1=1`
      : elasticIds?.length
        ? Prisma.sql`WHERE affiliation.affiliation_id IN (${Prisma.join(elasticIds.map(Number))})`
        : Prisma.sql`WHERE (affiliation.university_company LIKE ${`%${input.q}%`} OR affiliation.city_territory LIKE ${`%${input.q}%`} OR affiliation.address LIKE ${`%${input.q}%`} OR affiliation.country LIKE ${`%${input.q}%`})`;
    const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT COUNT(DISTINCT affiliation.affiliation_id) total
        FROM ijpass_journals.affiliationdata_tbl affiliation
        INNER JOIN ijpass_journals.authordata_tbl source_author
          ON ${affiliationNameMatch}
        INNER JOIN ijpass_journals.manuscript_author_tbl authorship
          ON authorship.author_data_id=source_author.author_data_id
        INNER JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.manuscript_id=authorship.manuscript_id
        INNER JOIN ijpass_journals.sourcedata_tbl visible_source
          ON visible_source.source_data_id=manuscript.journal_id
        LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
          ON visible_publisher.publisher_id=visible_source.publisher_id
        ${where}
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}`,
    );
    const totalRecords = Number(total),
      totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
      page = Math.min(input.page, totalPages),
      offset = (page - 1) * pageSize;
    const records = await prisma.$queryRaw<
      Array<{
        id: bigint;
        name: string;
        address: string;
        country: string;
        authors: bigint;
        papers: bigint;
      }>
    >(
      Prisma.sql`SELECT affiliation.affiliation_id id,affiliation.university_company name,affiliation.address,affiliation.country,COUNT(DISTINCT authorship.author_profile_id) authors,COUNT(DISTINCT authorship.manuscript_id) papers FROM ijpass_journals.affiliationdata_tbl affiliation INNER JOIN ijpass_journals.authordata_tbl source_author ON ${affiliationNameMatch} INNER JOIN ijpass_journals.manuscript_author_tbl authorship ON authorship.author_data_id=source_author.author_data_id INNER JOIN ijpass_journals.manuscript_tbl manuscript ON manuscript.manuscript_id=authorship.manuscript_id INNER JOIN ijpass_journals.sourcedata_tbl visible_source ON visible_source.source_data_id=manuscript.journal_id LEFT JOIN ijpass_journals.publisher_tbl visible_publisher ON visible_publisher.publisher_id=visible_source.publisher_id ${where} AND COALESCE(visible_source.active,1)=1 AND COALESCE(visible_publisher.active,1)=1 ${inactiveVisiblePublisherGuard} GROUP BY affiliation.affiliation_id,affiliation.university_company,affiliation.address,affiliation.country ORDER BY affiliation.university_company LIMIT ${pageSize} OFFSET ${offset}`,
    );
    const recordIds = records.map((record) => Number(record.id));
    const citationRows = recordIds.length ? await prisma.$queryRaw<Array<{
      affiliationId: bigint;
      manuscriptId: bigint;
      citations: bigint;
    }>>(Prisma.sql`
      SELECT affiliation.affiliation_id affiliationId,manuscript.manuscript_id manuscriptId,
        COUNT(DISTINCT reference.reference_id) citations
      FROM ijpass_journals.affiliationdata_tbl affiliation
      INNER JOIN ijpass_journals.authordata_tbl source_author
        ON ${affiliationNameMatch}
      INNER JOIN ijpass_journals.manuscript_author_tbl authorship
        ON authorship.author_data_id=source_author.author_data_id
      INNER JOIN ijpass_journals.manuscript_tbl manuscript
        ON manuscript.manuscript_id=authorship.manuscript_id
      INNER JOIN ijpass_journals.sourcedata_tbl visible_source
        ON visible_source.source_data_id=manuscript.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
        ON visible_publisher.publisher_id=visible_source.publisher_id
      LEFT JOIN ijpass_journals.refdat_table reference
        ON reference.publication_year=manuscript.publication_year
        AND LOWER(TRIM(reference.article_title))=LOWER(TRIM(manuscript.article_title))
        AND reference.manuscript_id<>manuscript.manuscript_id
      WHERE affiliation.affiliation_id IN (${Prisma.join(recordIds)})
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}
      GROUP BY affiliation.affiliation_id,manuscript.manuscript_id`) : [];
    const metrics = new Map<number, { citations: number; hIndex: number; i10Index: number }>();
    for (const record of records) {
      const citationCounts = citationRows.filter((row) => Number(row.affiliationId) === Number(record.id)).map((row) => Number(row.citations)).sort((a, b) => b - a);
      let hIndex = 0;
      citationCounts.forEach((count, index) => { if (count >= index + 1) hIndex = index + 1; });
      metrics.set(Number(record.id), { citations: citationCounts.reduce((total, count) => total + count, 0), hIndex, i10Index: citationCounts.filter((count) => count >= 10).length });
    }
    return res.json({
      affiliations: records.map((record) => ({
        ...record,
        id: Number(record.id),
        authors: Number(record.authors),
        papers: Number(record.papers),
        ...(metrics.get(Number(record.id)) ?? { citations: 0, hIndex: 0, i10Index: 0 }),
      })),
      pagination: { page, pageSize, totalRecords, totalPages },
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/indexing/countries/suggestions", async (req, res, next) => {
  try {
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
    const elasticCountries = await searchCountryIds(q);
    const where = elasticCountries !== null
      ? elasticCountries.length
        ? Prisma.sql`WHERE affiliation.country IN (${Prisma.join(elasticCountries)}) AND affiliation.country LIKE ${`%${q}%`}`
        : Prisma.sql`WHERE 1=0`
      : Prisma.sql`WHERE affiliation.country LIKE ${`%${q}%`}`;
    let rows = await prisma.$queryRaw<Array<{ country: string }>>(Prisma.sql`
      SELECT matches.country
      FROM (
        SELECT DISTINCT TRIM(affiliation.country) country
        FROM ijpass_journals.affiliationdata_tbl affiliation
        INNER JOIN ijpass_journals.authordata_tbl source_author
          ON LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company)))=LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)))
        INNER JOIN ijpass_journals.manuscript_author_tbl authorship
          ON authorship.author_data_id=source_author.author_data_id
        INNER JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.manuscript_id=authorship.manuscript_id
        INNER JOIN ijpass_journals.sourcedata_tbl visible_source
          ON visible_source.source_data_id=manuscript.journal_id
        LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
          ON visible_publisher.publisher_id=visible_source.publisher_id
        ${where}
          AND COALESCE(visible_source.active,1)=1
          AND COALESCE(visible_publisher.active,1)=1
          ${inactiveVisiblePublisherGuard}
      ) matches
      ORDER BY CASE WHEN matches.country LIKE ${`${q}%`} THEN 0 ELSE 1 END,matches.country
      LIMIT 8`);
    if (!rows.length && elasticCountries !== null)
      rows = await prisma.$queryRaw<Array<{ country: string }>>(Prisma.sql`
        SELECT DISTINCT TRIM(affiliation.country) country
        FROM ijpass_journals.affiliationdata_tbl affiliation
        INNER JOIN ijpass_journals.authordata_tbl source_author
          ON LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company)))=LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)))
        INNER JOIN ijpass_journals.manuscript_author_tbl authorship
          ON authorship.author_data_id=source_author.author_data_id
        INNER JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.manuscript_id=authorship.manuscript_id
        INNER JOIN ijpass_journals.sourcedata_tbl visible_source
          ON visible_source.source_data_id=manuscript.journal_id
        LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
          ON visible_publisher.publisher_id=visible_source.publisher_id
        WHERE affiliation.country LIKE ${`%${q}%`}
          AND COALESCE(visible_source.active,1)=1
          AND COALESCE(visible_publisher.active,1)=1
          ${inactiveVisiblePublisherGuard}
        GROUP BY TRIM(affiliation.country)
        ORDER BY TRIM(affiliation.country)
        LIMIT 8`);
    return res.json({ suggestions: rows.map((row) => row.country) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/indexing/countries", async (req, res, next) => {
  try {
    const input = publicIndexQuery.parse(req.query),
      pageSize = 20;
    const elasticIds = input.q
      ? await searchCountryIds(input.q)
      : null;
    const where = input.q
      ? elasticIds?.length
        ? Prisma.sql`WHERE affiliation.country IN (${Prisma.join(elasticIds)})`
        : Prisma.sql`WHERE affiliation.country LIKE ${`%${input.q}%`}`
      : Prisma.sql`WHERE TRIM(affiliation.country)<>''`;
    const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT COUNT(DISTINCT affiliation.country) total
        FROM ijpass_journals.affiliationdata_tbl affiliation
        INNER JOIN ijpass_journals.authordata_tbl source_author
          ON LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company)))=LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)))
        INNER JOIN ijpass_journals.manuscript_author_tbl authorship
          ON authorship.author_data_id=source_author.author_data_id
        INNER JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.manuscript_id=authorship.manuscript_id
        INNER JOIN ijpass_journals.sourcedata_tbl visible_source
          ON visible_source.source_data_id=manuscript.journal_id
        LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
          ON visible_publisher.publisher_id=visible_source.publisher_id
        ${where}
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}`,
    );
    const totalRecords = Number(total),
      totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
      page = Math.min(input.page, totalPages),
      offset = (page - 1) * pageSize;
    const records = await prisma.$queryRaw<
      Array<{
        country: string;
        affiliations: bigint;
        authors: bigint;
        papers: bigint;
      }>
    >(
      Prisma.sql`SELECT affiliation.country,COUNT(DISTINCT affiliation.affiliation_id) affiliations,COUNT(DISTINCT authorship.author_profile_id) authors,COUNT(DISTINCT authorship.manuscript_id) papers FROM ijpass_journals.affiliationdata_tbl affiliation INNER JOIN ijpass_journals.authordata_tbl source_author ON LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company)))=LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company))) INNER JOIN ijpass_journals.manuscript_author_tbl authorship ON authorship.author_data_id=source_author.author_data_id INNER JOIN ijpass_journals.manuscript_tbl manuscript ON manuscript.manuscript_id=authorship.manuscript_id INNER JOIN ijpass_journals.sourcedata_tbl visible_source ON visible_source.source_data_id=manuscript.journal_id LEFT JOIN ijpass_journals.publisher_tbl visible_publisher ON visible_publisher.publisher_id=visible_source.publisher_id ${where} AND COALESCE(visible_source.active,1)=1 AND COALESCE(visible_publisher.active,1)=1 ${inactiveVisiblePublisherGuard} GROUP BY affiliation.country ORDER BY affiliation.country LIMIT ${pageSize} OFFSET ${offset}`,
    );
    const recordCountries = records.map((record) => record.country);
    const citationRows = recordCountries.length ? await prisma.$queryRaw<Array<{
      country: string;
      manuscriptId: bigint;
      citations: bigint;
    }>>(Prisma.sql`
      SELECT affiliation.country,manuscript.manuscript_id manuscriptId,
        COUNT(DISTINCT reference.reference_id) citations
      FROM ijpass_journals.affiliationdata_tbl affiliation
      INNER JOIN ijpass_journals.authordata_tbl source_author
        ON LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company)))=
           LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)))
      INNER JOIN ijpass_journals.manuscript_author_tbl authorship
        ON authorship.author_data_id=source_author.author_data_id
      INNER JOIN ijpass_journals.manuscript_tbl manuscript
        ON manuscript.manuscript_id=authorship.manuscript_id
      INNER JOIN ijpass_journals.sourcedata_tbl visible_source
        ON visible_source.source_data_id=manuscript.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl visible_publisher
        ON visible_publisher.publisher_id=visible_source.publisher_id
      LEFT JOIN ijpass_journals.refdat_table reference
        ON reference.publication_year=manuscript.publication_year
        AND LOWER(TRIM(reference.article_title))=LOWER(TRIM(manuscript.article_title))
        AND reference.manuscript_id<>manuscript.manuscript_id
      WHERE affiliation.country IN (${Prisma.join(recordCountries)})
        AND COALESCE(visible_source.active,1)=1
        AND COALESCE(visible_publisher.active,1)=1
        ${inactiveVisiblePublisherGuard}
      GROUP BY affiliation.country,manuscript.manuscript_id`) : [];
    const countryMetrics = new Map<string, { hIndex: number; i10Index: number }>();
    for (const record of records) {
      const citationCounts = citationRows
        .filter((row) => row.country === record.country)
        .map((row) => Number(row.citations))
        .sort((first, second) => second - first);
      let hIndex = 0;
      citationCounts.forEach((count, index) => {
        if (count >= index + 1) hIndex = index + 1;
      });
      countryMetrics.set(record.country, {
        hIndex,
        i10Index: citationCounts.filter((count) => count >= 10).length,
      });
    }
    return res.json({
      countries: records.map((record) => ({
        ...record,
        affiliations: Number(record.affiliations),
        authors: Number(record.authors),
        papers: Number(record.papers),
        ...(countryMetrics.get(record.country) ?? { hIndex: 0, i10Index: 0 }),
      })),
      pagination: { page, pageSize, totalRecords, totalPages },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/journal-index/suggestions", async (req, res, next) => {
  try {
    const { q } = z.object({ q: z.string().trim().min(2).max(150) }).parse(req.query);
    const rows = await prisma.$queryRaw<Array<{ title: string }>>(Prisma.sql`
      SELECT DISTINCT TRIM(source.journal_title) title
      FROM ijpass_journals.sourcedata_tbl source
      LEFT JOIN ijpass_journals.publisher_tbl publisher
        ON publisher.publisher_id=source.publisher_id
      WHERE source.journal_title LIKE ${`%${q}%`}
        AND COALESCE(source.active,1)=1
        AND COALESCE(publisher.active,1)=1
        ${inactivePublisherGuard}
      ORDER BY title LIMIT 8`);
    return res.json({ suggestions: rows.map((row) => row.title) });
  } catch (error) { next(error); }
});

app.get("/api/journal-index/:sourceId/articles/suggestions", async (req, res, next) => {
  try {
    const sourceId = z.coerce.number().int().positive().parse(req.params.sourceId);
    const { q } = z.object({ q: z.string().trim().min(2).max(150) }).parse(req.query);
    const indexedIds = await searchManuscriptIds(q, sourceId);
    const where = indexedIds !== null
      ? indexedIds.length
        ? Prisma.sql`manuscript.manuscript_id IN (${Prisma.join(indexedIds.map(Number))})`
        : Prisma.sql`1=0`
      : Prisma.sql`manuscript.journal_id=${sourceId} AND manuscript.article_title LIKE ${`%${q}%`}`;
    const rows = await prisma.$queryRaw<Array<{ title: string }>>(Prisma.sql`
      SELECT TRIM(manuscript.article_title) title
      FROM ijpass_journals.manuscript_tbl manuscript
      INNER JOIN ijpass_journals.sourcedata_tbl source
        ON source.source_data_id=manuscript.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl publisher
        ON publisher.publisher_id=source.publisher_id
      WHERE manuscript.journal_id=${sourceId} AND ${where}
        AND COALESCE(source.active,1)=1
        AND COALESCE(publisher.active,1)=1
        ${inactivePublisherGuard}
      ORDER BY CASE WHEN manuscript.article_title LIKE ${`${q}%`} THEN 0 ELSE 1 END,manuscript.article_title LIMIT 8`);
    return res.json({ suggestions: rows.map((row) => row.title) });
  } catch (error) { next(error); }
});

app.get("/api/journal-index", async (req, res, next) => {
  try {
    const input = z
      .object({
        q: z.string().trim().max(150).catch(""),
        page: z.coerce.number().int().positive().catch(1),
      })
      .parse(req.query);
    const pageSize = 20;
    const elasticIds = input.q
      ? await searchIndexIds("ijpass-resources", input.q, ["title^4"], "title.keyword")
      : null;
    const search = !input.q
      ? Prisma.empty
      : elasticIds?.length
        ? Prisma.sql`AND source.source_data_id IN (${Prisma.join(elasticIds.map(Number))})`
        : Prisma.sql`AND source.journal_title LIKE ${`%${input.q}%`}`;
    const [{ total }] = await prisma.$queryRaw<
      Array<{ total: bigint }>
    >(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM ijpass_journals.sourcedata_tbl AS source
      LEFT JOIN ijpass_journals.publisher_tbl publisher
        ON publisher.publisher_id=source.publisher_id
      WHERE COALESCE(source.active,1)=1
        AND COALESCE(publisher.active,1)=1
        ${inactivePublisherGuard}
        ${search}
    `);
    const totalRecords = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const page = Math.min(input.page, totalPages);
    const offset = (page - 1) * pageSize;
    const records = await prisma.$queryRaw<
      Array<{
        id: bigint;
        title: string;
        articleCount: bigint;
        citationCount: bigint;
      }>
    >(Prisma.sql`
      SELECT
        source.source_data_id AS id,
        TRIM(source.journal_title) AS title,
        COUNT(manuscript.manuscript_id) AS articleCount,
        COALESCE(MAX(citation_totals.citation_count), 0) AS citationCount
      FROM ijpass_journals.sourcedata_tbl AS source
      LEFT JOIN ijpass_journals.publisher_tbl publisher
        ON publisher.publisher_id=source.publisher_id
      LEFT JOIN ijpass_journals.manuscript_tbl AS manuscript
        ON manuscript.journal_id = source.source_data_id
      LEFT JOIN (
        SELECT cited_manuscript.journal_id, COUNT(*) AS citation_count
        FROM ijpass_journals.manuscript_tbl AS cited_manuscript
        INNER JOIN ijpass_journals.refdat_table AS matching_reference
          ON matching_reference.publication_year = cited_manuscript.publication_year
          AND REGEXP_REPLACE(LOWER(TRIM(matching_reference.article_title)), '[^[:alnum:]]+', '') = REGEXP_REPLACE(LOWER(TRIM(cited_manuscript.article_title)), '[^[:alnum:]]+', '')
          AND matching_reference.manuscript_id <> cited_manuscript.manuscript_id
        GROUP BY cited_manuscript.journal_id
      ) AS citation_totals
        ON citation_totals.journal_id = source.source_data_id
      WHERE COALESCE(source.active,1)=1
        AND COALESCE(publisher.active,1)=1
        ${inactivePublisherGuard}
        ${search}
      GROUP BY source.source_data_id, source.journal_title
      ORDER BY citationCount DESC, articleCount DESC, TRIM(source.journal_title) ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    res.set("Cache-Control", "public, max-age=60");
    return res.json({
      journals: records.map((record) => ({
        id: Number(record.id),
        title: record.title,
        articleCount: Number(record.articleCount),
        citationCount: Number(record.citationCount),
      })),
      pagination: { page, pageSize, totalRecords, totalPages },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/journal-index/:sourceId/profile", async (req, res, next) => {
  try {
    const sourceId = z.coerce.number().int().positive().parse(req.params.sourceId);
    const currentYear = new Date().getFullYear();
    const metricYear = z.coerce.number().int().min(2018).max(currentYear).catch(currentYear).parse(req.query.year);
    const [resource] = await prisma.$queryRaw<Array<{
      id: bigint;
      title: string;
      abbreviation: string | null;
      indexedFromYear: number | null;
      subjectArea: string | null;
      resourceType: string;
      publisher: string | null;
      country: string | null;
      website: string | null;
      editorInChief: string | null;
      editorInChiefEmail: string | null;
    }>>(Prisma.sql`
      SELECT source.source_data_id id,TRIM(source.journal_title) title,
        NULLIF(TRIM(source.abbreviation),'') abbreviation,
        source.indexed_from_year indexedFromYear,
        NULLIF(TRIM(source.subject_area),'') subjectArea,
        COALESCE(NULLIF(TRIM(source.source_type),''),'Journal') resourceType,
        COALESCE(NULLIF(TRIM(publisher.publisher_name),''),NULLIF(TRIM(source.publisher),'')) publisher,
        NULLIF(TRIM(publisher.country),'') country,
        NULLIF(TRIM(source.website),'') website,
        NULLIF(TRIM(publisher.chief_editor),'') editorInChief,
        COALESCE(NULLIF(TRIM(source.email),''),NULLIF(TRIM(publisher.email),'')) editorInChiefEmail
      FROM ijpass_journals.sourcedata_tbl source
      LEFT JOIN ijpass_journals.publisher_tbl publisher
        ON publisher.publisher_id=source.publisher_id
      WHERE source.source_data_id=${sourceId}
        AND COALESCE(source.active,1)=1
        AND COALESCE(publisher.active,1)=1
        ${inactivePublisherGuard}
      LIMIT 1`);
    if (!resource) return res.status(404).json({ message: "Indexed resource not found" });

    const [coverageRows, subjectRows, [coverageSummary]] = await Promise.all([
      prisma.$queryRaw<Array<{ year: number; articles: bigint }>>(Prisma.sql`
        SELECT publication_year year,COUNT(*) articles
        FROM ijpass_journals.manuscript_tbl
        WHERE journal_id=${sourceId} AND publication_year IS NOT NULL
        GROUP BY publication_year ORDER BY publication_year`),
      prisma.$queryRaw<Array<{ id: bigint; subjectArea: string; articles: bigint }>>(Prisma.sql`
        SELECT subject.subject_area_id id,subject.subject_area subjectArea,COUNT(*) articles
        FROM ijpass_journals.manuscript_tbl manuscript
        INNER JOIN ijpass_journals.subject_area_tbl subject
          ON subject.subject_area_id=manuscript.subject_area_id
        WHERE manuscript.journal_id=${sourceId}
        GROUP BY subject.subject_area_id,subject.subject_area
        ORDER BY articles DESC,subject.subject_area`),
      prisma.$queryRaw<Array<{
        articles: bigint;
        authors: bigint;
        earliestYear: number | null;
        latestYear: number | null;
        volumes: bigint;
        issues: bigint;
        doiRecords: bigint;
      }>>(Prisma.sql`
        SELECT COUNT(DISTINCT manuscript.manuscript_id) articles,
          COUNT(DISTINCT authorship.author_data_id) authors,
          MIN(manuscript.publication_year) earliestYear,
          MAX(manuscript.publication_year) latestYear,
          COUNT(DISTINCT NULLIF(TRIM(manuscript.volume),'')) volumes,
          COUNT(DISTINCT CONCAT(COALESCE(manuscript.volume,''),'|',COALESCE(manuscript.issue,''))) issues,
          SUM(NULLIF(TRIM(manuscript.doi),'') IS NOT NULL) doiRecords
        FROM ijpass_journals.manuscript_tbl manuscript
        LEFT JOIN ijpass_journals.manuscript_author_tbl authorship
          ON authorship.manuscript_id=manuscript.manuscript_id
        WHERE manuscript.journal_id=${sourceId}`),
    ]);

    const primarySubject = subjectRows[0] ?? null;
    const metricStartYear = metricYear - 2;
    const trendYears = Array.from({ length: Math.min(5, metricYear - 2017) }, (_, index) => metricYear - Math.min(5, metricYear - 2017) + 1 + index);
    const metricMaps = await Promise.all(trendYears.map((year) => getResourceMetrics(prisma, year)));
    const selectedMetricMap = metricMaps[metricMaps.length - 1];
    const selectedMetric = selectedMetricMap.get(sourceId) ?? {
      papers: 0,
      citations: 0,
      citeMetrixScore: 0,
      percentile: 0,
      citedPercent: 0,
      hIndex: 0,
      i10Index: 0,
    };
    const peerRows = primarySubject
      ? await prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
          SELECT DISTINCT journal_id id
          FROM ijpass_journals.manuscript_tbl
          WHERE subject_area_id=${Number(primarySubject.id)}`)
      : await prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
          SELECT source_data_id id FROM ijpass_journals.sourcedata_tbl`);
    const peerMetrics = peerRows
      .map((row) => selectedMetricMap.get(Number(row.id)))
      .filter((metric): metric is NonNullable<typeof metric> => Boolean(metric?.papers));
    const higher = peerMetrics.filter((metric) => metric.citeMetrixScore > selectedMetric.citeMetrixScore).length;
    const lower = peerMetrics.filter((metric) => metric.citeMetrixScore < selectedMetric.citeMetrixScore).length;
    const same = peerMetrics.filter((metric) => metric.citeMetrixScore === selectedMetric.citeMetrixScore).length;
    const rank = selectedMetric.papers ? higher + 1 : 0;
    const percentile = peerMetrics.length && selectedMetric.papers
      ? Math.floor(100 * (lower + 0.5 * same) / peerMetrics.length)
      : 0;
    const quartile = percentile >= 75 ? "Q1" : percentile >= 50 ? "Q2" : percentile >= 25 ? "Q3" : selectedMetric.papers ? "Q4" : "—";
    const derivedSubjectArea = resource.subjectArea || primarySubject?.subjectArea || null;
    const fromYear = coverageSummary.earliestYear ?? resource.indexedFromYear;
    const toYear = coverageSummary.latestYear ?? resource.indexedFromYear;

    res.set("Cache-Control", "public, max-age=60");
    return res.json({
      resource: {
        ...resource,
        id: Number(resource.id),
        subjectArea: derivedSubjectArea,
        yearsCovered: { from: fromYear, to: toYear },
      },
      citeMetrix: {
        startYear: metricStartYear,
        endYear: metricYear,
        ...selectedMetric,
      },
      researchInsights: {
        rank,
        peerResources: peerMetrics.length,
        percentile,
        quartile,
        subjectArea: derivedSubjectArea,
        trend: trendYears.map((year, index) => {
          const metric = metricMaps[index].get(sourceId);
          return {
            year,
            startYear: year - 2,
            score: metric?.citeMetrixScore ?? 0,
            papers: metric?.papers ?? 0,
            citations: metric?.citations ?? 0,
          };
        }),
      },
      scholarlyCoverage: {
        articles: Number(coverageSummary.articles),
        authors: Number(coverageSummary.authors),
        volumes: Number(coverageSummary.volumes),
        issues: Number(coverageSummary.issues),
        doiRecords: Number(coverageSummary.doiRecords),
        years: coverageRows.map((row) => ({ year: row.year, articles: Number(row.articles) })),
        subjectAreas: subjectRows.map((row) => ({
          id: Number(row.id),
          subjectArea: row.subjectArea,
          articles: Number(row.articles),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/journal-index/:sourceId/articles", async (req, res, next) => {
  try {
    const sourceId = z.coerce
      .number()
      .int()
      .positive()
      .parse(req.params.sourceId);
    const input = z
      .object({
        q: z.string().trim().max(150).catch(""),
        page: z.coerce.number().int().positive().catch(1),
        year: z.coerce.number().int().min(1000).max(9999).optional().catch(undefined),
      })
      .parse(req.query);
    const [journal] = await prisma.$queryRaw<
      Array<{ id: bigint; title: string; abbreviation: string | null }>
    >(Prisma.sql`
      SELECT source_data_id AS id, TRIM(journal_title) AS title, TRIM(abbreviation) AS abbreviation
      FROM ijpass_journals.sourcedata_tbl source
      LEFT JOIN ijpass_journals.publisher_tbl publisher ON publisher.publisher_id=source.publisher_id
      WHERE source.source_data_id = ${sourceId}
        AND COALESCE(source.active,1)=1
        AND COALESCE(publisher.active,1)=1
        ${inactivePublisherGuard}
      LIMIT 1
    `);
    if (!journal)
      return res.status(404).json({ message: "Indexed journal not found" });
    const pageSize = 20;
    const elasticIds = input.q ? await searchManuscriptIds(input.q, sourceId) : null;
    const search = input.q
      ? elasticIds?.length
        ? Prisma.sql`AND manuscript.manuscript_id IN (${Prisma.join(elasticIds.map(Number))})`
        : Prisma.sql`
      AND (
        manuscript.article_title LIKE ${`%${input.q}%`}
        OR EXISTS (
          SELECT 1
          FROM ijpass_journals.manuscript_author_tbl AS search_link
          INNER JOIN ijpass_journals.authordata_tbl AS search_author
            ON search_author.author_data_id = search_link.author_data_id
          WHERE search_link.manuscript_id = manuscript.manuscript_id
            AND search_author.author_name LIKE ${`%${input.q}%`}
        )
      )
    `
      : Prisma.empty;
    const yearFilter = input.year
      ? Prisma.sql`AND manuscript.publication_year=${input.year}`
      : Prisma.empty;
    const [{ total, totalCitations }] = await prisma.$queryRaw<
      Array<{ total: bigint; totalCitations: bigint }>
    >(Prisma.sql`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM((
          SELECT COUNT(*)
          FROM ijpass_journals.refdat_table AS citation_reference
          WHERE citation_reference.publication_year = manuscript.publication_year
            AND REGEXP_REPLACE(LOWER(TRIM(citation_reference.article_title)), '[^[:alnum:]]+', '') = REGEXP_REPLACE(LOWER(TRIM(manuscript.article_title)), '[^[:alnum:]]+', '')
            AND citation_reference.manuscript_id <> manuscript.manuscript_id
        )), 0) AS totalCitations
      FROM ijpass_journals.manuscript_tbl AS manuscript
      WHERE manuscript.journal_id = ${sourceId}
        AND EXISTS (
          SELECT 1
          FROM ijpass_journals.sourcedata_tbl source
          WHERE source.source_data_id = manuscript.journal_id
            AND COALESCE(source.active,1)=1
        )
      ${search}
      ${yearFilter}
    `);
    const totalRecords = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const page = Math.min(input.page, totalPages);
    const offset = (page - 1) * pageSize;
    const records = await prisma.$queryRaw<
      Array<{
        id: bigint;
        title: string;
        authors: string | null;
        volume: string | null;
        issue: string | null;
        publicationYear: number | null;
        citationCount: bigint;
      }>
    >(Prisma.sql`
      SELECT
        manuscript.manuscript_id AS id,
        TRIM(manuscript.article_title) AS title,
        GROUP_CONCAT(author.author_name ORDER BY authorship.author_order SEPARATOR ', ') AS authors,
        manuscript.volume,
        manuscript.issue,
        manuscript.publication_year AS publicationYear,
        (SELECT COUNT(*)
          FROM ijpass_journals.refdat_table AS citation_reference
          WHERE citation_reference.publication_year = manuscript.publication_year
            AND REGEXP_REPLACE(LOWER(TRIM(citation_reference.article_title)), '[^[:alnum:]]+', '') = REGEXP_REPLACE(LOWER(TRIM(manuscript.article_title)), '[^[:alnum:]]+', '')
            AND citation_reference.manuscript_id <> manuscript.manuscript_id
        ) AS citationCount
      FROM ijpass_journals.manuscript_tbl AS manuscript
      LEFT JOIN ijpass_journals.manuscript_author_tbl AS authorship
        ON authorship.manuscript_id = manuscript.manuscript_id
      LEFT JOIN ijpass_journals.authordata_tbl AS author
        ON author.author_data_id = authorship.author_data_id
      WHERE manuscript.journal_id = ${sourceId}
      ${search}
      ${yearFilter}
      GROUP BY manuscript.manuscript_id, manuscript.article_title, manuscript.volume, manuscript.issue, manuscript.publication_year
      ORDER BY citationCount DESC, manuscript.publication_year DESC, manuscript.manuscript_id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    const manuscriptIds = records.map((record) => Number(record.id));
    const linkedAuthors = manuscriptIds.length
      ? await prisma.$queryRaw<Array<{ manuscriptId: bigint; profileId: bigint | null; name: string }>>(Prisma.sql`
          SELECT authorship.manuscript_id AS manuscriptId,
            authorship.author_profile_id AS profileId,
            TRIM(COALESCE(profile.author_name, author.author_name)) AS name
          FROM ijpass_journals.manuscript_author_tbl AS authorship
          INNER JOIN ijpass_journals.authordata_tbl AS author
            ON author.author_data_id = authorship.author_data_id
          LEFT JOIN ijpass_journals.author_profile_tbl AS profile
            ON profile.author_profile_id = authorship.author_profile_id
          WHERE authorship.manuscript_id IN (${Prisma.join(manuscriptIds)})
          ORDER BY authorship.manuscript_id, authorship.author_order
        `)
      : [];
    res.set("Cache-Control", "public, max-age=60");
    return res.json({
      journal: { id: Number(journal.id), title: journal.title, abbreviation: journal.abbreviation },
      articles: records.map((record) => ({
        id: Number(record.id),
        title: record.title,
        authors: record.authors || "Author information unavailable",
        volume: record.volume,
        issue: record.issue,
        publicationYear: record.publicationYear,
        citationCount: Number(record.citationCount),
        authorProfiles: linkedAuthors
          .filter((author) => Number(author.manuscriptId) === Number(record.id))
          .map((author) => ({
            profileId: author.profileId === null ? null : Number(author.profileId),
            name: author.name,
          })),
      })),
      reportSummary: { totalCitations: Number(totalCitations) },
      pagination: { page, pageSize, totalRecords, totalPages },
    });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/journal-index/:sourceId/articles/:manuscriptId",
  async (req, res, next) => {
    try {
      const params = z
        .object({
          sourceId: z.coerce.number().int().positive(),
          manuscriptId: z.coerce.number().int().positive(),
        })
        .parse(req.params);
      const [article] = await prisma.$queryRaw<
        Array<{
          id: bigint;
          journalId: bigint;
          journalTitle: string;
          title: string;
          volume: string | null;
          issue: string | null;
          pages: string | null;
          publicationYear: number | null;
          doi: string | null;
          articleLink: string | null;
          abstract: string | null;
          keywords: string | null;
        }>
      >(Prisma.sql`
      SELECT
        manuscript.manuscript_id AS id,
        source.source_data_id AS journalId,
        TRIM(source.journal_title) AS journalTitle,
        TRIM(manuscript.article_title) AS title,
        manuscript.volume,
        manuscript.issue,
        manuscript.pages,
        manuscript.publication_year AS publicationYear,
        manuscript.doi,
        manuscript.article_link AS articleLink,
        manuscript.abstract,
        manuscript.keywords
      FROM ijpass_journals.manuscript_tbl AS manuscript
      INNER JOIN ijpass_journals.sourcedata_tbl AS source
        ON source.source_data_id = manuscript.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl AS publisher
        ON publisher.publisher_id = source.publisher_id
      WHERE source.source_data_id = ${params.sourceId}
        AND manuscript.manuscript_id = ${params.manuscriptId}
        AND COALESCE(source.active,1)=1
        AND COALESCE(publisher.active,1)=1
        ${inactivePublisherGuard}
      LIMIT 1
    `);
      if (!article)
        return res.status(404).json({ message: "Indexed article not found" });
      const [authors, references] = await Promise.all([
        prisma.$queryRaw<
          Array<{
            profileId: bigint | null;
            name: string;
            designation: string | null;
            affiliation: string | null;
            country: string | null;
            orcid: string | null;
          }>
        >(Prisma.sql`
        SELECT
          authorship.author_profile_id AS profileId,
          author.author_name AS name,
          author.department_designation AS designation,
          author.university_company AS affiliation,
          author.country,
          profile.orcid
        FROM ijpass_journals.manuscript_author_tbl AS authorship
        INNER JOIN ijpass_journals.authordata_tbl AS author
          ON author.author_data_id = authorship.author_data_id
        LEFT JOIN ijpass_journals.author_profile_tbl AS profile
          ON profile.author_profile_id = authorship.author_profile_id
        WHERE authorship.manuscript_id = ${params.manuscriptId}
        ORDER BY authorship.author_order ASC
      `),
        prisma.$queryRaw<
          Array<{
            id: bigint;
            number: number;
            text: string;
            doi: string | null;
            link: string | null;
          }>
        >(Prisma.sql`
        SELECT reference_id AS id, reference_number AS number, raw_reference AS text, doi, article_link AS link
        FROM ijpass_journals.refdat_table
        WHERE manuscript_id = ${params.manuscriptId}
        ORDER BY reference_number ASC
      `),
      ]);
      const citations =
        article.publicationYear === null
          ? []
          : await prisma.$queryRaw<
              Array<{
                id: bigint;
                sourceId: bigint;
                title: string;
                journalTitle: string;
                publicationYear: number | null;
                authors: string | null;
                matchedReference: string;
              }>
            >(Prisma.sql`
      SELECT
        citing.manuscript_id AS id,
        citing_source.source_data_id AS sourceId,
        TRIM(citing.article_title) AS title,
        TRIM(citing_source.journal_title) AS journalTitle,
        citing.publication_year AS publicationYear,
        GROUP_CONCAT(citing_author.author_name ORDER BY citing_authorship.author_order SEPARATOR ', ') AS authors,
        cited_reference.raw_reference AS matchedReference
      FROM ijpass_journals.refdat_table AS cited_reference
      INNER JOIN ijpass_journals.manuscript_tbl AS citing
        ON citing.manuscript_id = cited_reference.manuscript_id
      INNER JOIN ijpass_journals.sourcedata_tbl AS citing_source
        ON citing_source.source_data_id = citing.journal_id
      LEFT JOIN ijpass_journals.publisher_tbl AS citing_publisher
        ON citing_publisher.publisher_id = citing_source.publisher_id
      LEFT JOIN ijpass_journals.manuscript_author_tbl AS citing_authorship
        ON citing_authorship.manuscript_id = citing.manuscript_id
      LEFT JOIN ijpass_journals.authordata_tbl AS citing_author
        ON citing_author.author_data_id = citing_authorship.author_data_id
      WHERE cited_reference.publication_year = ${article.publicationYear}
        AND COALESCE(citing_source.active,1)=1
        AND COALESCE(citing_publisher.active,1)=1
        AND NOT EXISTS (
          SELECT 1
          FROM ijpass_journals.publisher_tbl inactive_citing_publisher
          WHERE COALESCE(inactive_citing_publisher.active,1)=0
            AND (
              inactive_citing_publisher.publisher_id=citing_source.publisher_id
              OR TRIM(inactive_citing_publisher.publisher_name)=TRIM(COALESCE(citing_publisher.publisher_name,citing_source.publisher))
            )
        )
        AND REGEXP_REPLACE(LOWER(TRIM(cited_reference.article_title)), '[^[:alnum:]]+', '') = REGEXP_REPLACE(LOWER(TRIM(${article.title})), '[^[:alnum:]]+', '')
        AND citing.manuscript_id <> ${params.manuscriptId}
      GROUP BY citing.manuscript_id, citing_source.source_data_id, citing.article_title, citing_source.journal_title, citing.publication_year, cited_reference.reference_id, cited_reference.raw_reference
      ORDER BY citing.publication_year DESC, citing.manuscript_id DESC
    `);
      const authorNames =
        authors.map((author) => author.name).join(", ") ||
        "Author information unavailable";
      const doiUrl = article.doi
        ? /^https?:\/\//i.test(article.doi)
          ? article.doi
          : `https://doi.org/${article.doi.replace(/^doi:\s*/i, "")}`
        : null;
      const paperUrl = article.articleLink
        ? /^https?:\/\//i.test(article.articleLink)
          ? article.articleLink
          : `https://${article.articleLink.replace(/^\/+/, "")}`
        : null;
      const volumeIssue = article.volume
        ? `${article.volume}${article.issue ? `(${article.issue})` : ""}`
        : article.issue
          ? `(${article.issue})`
          : "";
      const apaCitation = `${authorNames} (${article.publicationYear || "n.d."}). ${article.title}. ${article.journalTitle}${volumeIssue ? `, ${volumeIssue}` : ""}.${doiUrl ? ` ${doiUrl}` : ""}`;
      res.set("Cache-Control", "public, max-age=60");
      return res.json({
        article: {
          id: Number(article.id),
          journalId: Number(article.journalId),
          journalTitle: article.journalTitle,
          title: article.title,
          volume: article.volume,
          issue: article.issue,
          publicationYear: article.publicationYear,
          pages: article.pages,
          doi: article.doi,
          doiUrl,
          articleLink: paperUrl,
          abstract: article.abstract,
          keywords: article.keywords,
          apaCitation,
        },
        authors: authors.map((author) => ({
          ...author,
          profileId: author.profileId === null ? null : Number(author.profileId),
        })),
        references: references.map((reference) => ({
          id: Number(reference.id),
          number: reference.number,
          text: reference.text,
          doi: reference.doi,
          link: reference.link,
        })),
        citations: citations.map((citation) => ({
          id: Number(citation.id),
          sourceId: Number(citation.sourceId),
          title: citation.title,
          journalTitle: citation.journalTitle,
          publicationYear: citation.publicationYear,
          authors: citation.authors || "Author information unavailable",
          matchedReference: citation.matchedReference,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });
    const valid =
      user &&
      user.active &&
      user.role === input.role &&
      (await bcrypt.compare(input.password, user.password));
    if (!valid)
      return res
        .status(401)
        .json({ message: "Email, password, or access type is incorrect" });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const token = createToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        organization: user.organization,
        role: user.role,
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.id },
      select: {
        id: true,
        name: true,
        email: true,
        organization: true,
        role: true,
        active: true,
        permissions: true,
      },
    });
    if (!user?.active)
      return res.status(401).json({ message: "Account is inactive" });
    return res.json({ user });
  } catch (error) {
    next(error);
  }
});

const adminPermissionForPath = (requestPath: string): InternalPermission | null => {
  const routes: Array<[string, InternalPermission]> = [
    ["/journal-publishers", "journal-publishers"],
    ["/sources", "sources"],
    ["/manuscripts", "manuscripts"],
    ["/author-profiles", "author-profiles"],
    ["/affiliation-profiles", "affiliation-profiles"],
    ["/membership-categories", "membership-categories"],
    ["/members", "members"],
    ["/author-merge-requests", "author-merge-requests"],
    ["/affiliation-merge-requests", "affiliation-merge-requests"],
    ["/membership-applications", "applications"],
  ];
  return routes.find(([prefix]) => requestPath === prefix || requestPath.startsWith(`${prefix}/`))?.[1] ?? null;
};

app.use("/api/admin", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (req.auth?.role === UserRole.SUPER_ADMIN || req.path === "/summary") return next();
    if (req.auth?.role !== UserRole.INTERNAL_USER)
      return res.status(403).json({ message: "You do not have permission to access this resource" });
    const requiredPermission = adminPermissionForPath(req.path);
    if (!requiredPermission)
      return res.status(403).json({ message: "You do not have permission to access this form" });
    const account = await prisma.user.findUnique({ where: { id: req.auth.id }, select: { active: true, permissions: true } });
    const permissions = Array.isArray(account?.permissions) ? account.permissions.filter((value): value is string => typeof value === "string") : [];
    if (!account?.active || !permissions.includes(requiredPermission))
      return res.status(403).json({ message: "You do not have permission to access this form" });
    return next();
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/summary",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN, UserRole.INTERNAL_USER),
  async (_req, res, next) => {
    try {
      const [users, journals, applications, messages] = await Promise.all([
        prisma.user.count(),
        prisma.journal.count(),
        prisma.application.count(),
        prisma.contactMessage.count(),
      ]);
      res.json({ users, journals, applications, messages });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/internal-users",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req, res, next) => {
    try {
      const users = await prisma.user.findMany({
        where: { role: UserRole.INTERNAL_USER },
        select: {
          id: true,
          name: true,
          email: true,
          organization: true,
          role: true,
          active: true,
          permissions: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
      res.json({ users });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/author-profiles",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z
          .object({
            q: z.string().trim().max(150).catch(""),
            page: z.coerce.number().int().positive().catch(1),
            sort: z.enum(["name", "newest", "email", "articles"]).catch("name"),
          })
          .parse(req.query),
        pageSize = 20;
      const search = input.q
        ? Prisma.sql`WHERE profile.author_name LIKE ${`%${input.q}%`} OR profile.email LIKE ${`%${input.q}%`} OR profile.orcid LIKE ${`%${input.q}%`} OR CAST(profile.author_profile_id AS CHAR) LIKE ${`%${input.q}%`}`
        : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) total FROM ijpass_journals.author_profile_tbl profile ${search}`,
      );
      const totalRecords = Number(total),
        totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
        page = Math.min(input.page, totalPages),
        offset = (page - 1) * pageSize;
      const order =
        input.sort === "newest"
          ? Prisma.sql`profile.author_profile_id DESC`
          : input.sort === "email"
            ? Prisma.sql`profile.email ASC, profile.author_name ASC`
            : input.sort === "articles"
              ? Prisma.sql`articleCount DESC, profile.author_name ASC`
              : Prisma.sql`profile.author_name ASC`;
      const records = await prisma.$queryRaw<
        Array<{
          id: bigint;
          salutation: string | null;
          authorName: string;
          email: string | null;
          orcid: string | null;
          affiliation: string | null;
          country: string | null;
          articleCount: bigint;
        }>
      >(Prisma.sql`
      SELECT profile.author_profile_id id, profile.salutation, profile.author_name authorName, profile.email, profile.orcid,
        MAX(affiliation.university_company) affiliation, MAX(affiliation.country) country,
        COUNT(DISTINCT manuscript_author.manuscript_id) articleCount
      FROM ijpass_journals.author_profile_tbl profile
      LEFT JOIN ijpass_journals.author_affiliation_tbl link ON link.author_profile_id=profile.author_profile_id AND link.is_current=1
      LEFT JOIN ijpass_journals.affiliationdata_tbl affiliation ON affiliation.affiliation_id=link.affiliation_id
      LEFT JOIN ijpass_journals.manuscript_author_tbl manuscript_author ON manuscript_author.author_profile_id=profile.author_profile_id
      ${search} GROUP BY profile.author_profile_id, profile.salutation, profile.author_name, profile.email, profile.orcid ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`);
      const authorDetails = await getMergeAuthorProfiles(records.map((record) => Number(record.id)));
      return res.json({
        profiles: records.map((record) => {
          const authorDetail = authorDetails.find((profile) => profile.id === Number(record.id));
          return {
            ...record,
            id: Number(record.id),
            articleCount: Number(record.articleCount),
            affiliations: authorDetail?.affiliations ?? [],
          };
        }),
        page,
        totalPages,
        totalRecords,
      });
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/admin/author-profiles/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [profile] = await prisma.$queryRaw<
        Array<{
          id: bigint;
          salutation: string | null;
          authorName: string;
          department: string | null;
          designation: string | null;
          email: string | null;
          orcid: string | null;
        }>
      >(
        Prisma.sql`SELECT author_profile_id id,salutation,author_name authorName,department,designation,email,orcid FROM ijpass_journals.author_profile_tbl WHERE author_profile_id=${id}`,
      );
      if (!profile)
        return res.status(404).json({ message: "Author profile not found" });
      const [detailedProfile] = await getMergeAuthorProfiles([id]);
      const linkedAffiliations = await prisma.$queryRaw<Array<{
        id: bigint;
        name: string;
        address: string;
        country: string;
      }>>(Prisma.sql`
        SELECT affiliation.affiliation_id id,affiliation.university_company name,
          affiliation.address,affiliation.country
        FROM ijpass_journals.author_affiliation_tbl link
        INNER JOIN ijpass_journals.affiliationdata_tbl affiliation
          ON affiliation.affiliation_id=link.affiliation_id
        WHERE link.author_profile_id=${id}
        ORDER BY affiliation.university_company`);
      return res.json({
        profile: {
          ...profile,
          id: Number(profile.id),
          articleCount: detailedProfile?.papers ?? 0,
          affiliations: detailedProfile?.affiliations ?? [],
          linkedAffiliations: linkedAffiliations.map((affiliation) => ({ ...affiliation, id: Number(affiliation.id) })),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/admin/author-profiles",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = normalizeAuthorProfile(authorProfileSchema.parse(req.body));
      const inputAffiliations = input.affiliations;
      if (!inputAffiliations?.length)
        return res.status(400).json({ message: "Select an affiliation for this author" });
      await prisma.$transaction(async (tx) => {
        const [{ nextId }] = await tx.$queryRaw<Array<{ nextId: number }>>(
          Prisma.sql`SELECT COALESCE(MAX(source_author_id),0)+1 nextId FROM ijpass_journals.author_profile_tbl`,
        );
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO ijpass_journals.author_profile_tbl(source_author_id,salutation,author_name,department,designation,email,orcid) VALUES(${nextId},${input.salutation || null},${input.authorName},${input.department || null},${input.designation || null},${input.email || null},${input.orcid || null})`,
        );
        const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`SELECT LAST_INSERT_ID() id`);
        for (const affiliation of inputAffiliations) {
          const linked = await tx.$executeRaw(Prisma.sql`
            INSERT INTO ijpass_journals.author_affiliation_tbl
              (author_profile_id,affiliation_id,is_current)
            SELECT ${Number(id)},affiliation_id,1
            FROM ijpass_journals.affiliationdata_tbl
            WHERE affiliation_id=${affiliation.affiliationId}`);
          if (!linked)
            throw Object.assign(new Error(`Affiliation ID ${affiliation.affiliationId} was not found`), { statusCode: 400 });
        }
      });
      return res
        .status(201)
        .json({ message: "Author profile added successfully" });
    } catch (error) {
      next(error);
    }
  },
);
app.put(
  "/api/admin/author-profiles/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id),
        input = normalizeAuthorProfile(authorProfileSchema.parse(req.body));
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.$executeRaw(
          Prisma.sql`UPDATE ijpass_journals.author_profile_tbl SET salutation=${input.salutation || null},author_name=${input.authorName},department=${input.department || null},designation=${input.designation || null},email=${input.email || null},orcid=${input.orcid || null} WHERE author_profile_id=${id}`,
        );
        const affiliationIds = [...new Set((input.affiliations ?? []).map((affiliation) => affiliation.affiliationId))];
        for (const affiliationId of affiliationIds)
          await tx.$executeRaw(Prisma.sql`
            INSERT IGNORE INTO ijpass_journals.author_affiliation_tbl(author_profile_id,affiliation_id,is_current)
            SELECT ${id},affiliation_id,1 FROM ijpass_journals.affiliationdata_tbl WHERE affiliation_id=${affiliationId}`);
        if (affiliationIds.length)
          await tx.$executeRaw(Prisma.sql`DELETE FROM ijpass_journals.author_affiliation_tbl WHERE author_profile_id=${id} AND affiliation_id NOT IN (${Prisma.join(affiliationIds)})`);
        else
          await tx.$executeRaw(Prisma.sql`DELETE FROM ijpass_journals.author_affiliation_tbl WHERE author_profile_id=${id}`);
        const departmentDesignation = [input.department, input.designation].filter(Boolean).join(" - ");
        await tx.$executeRaw(Prisma.sql`
          UPDATE ijpass_journals.authordata_tbl source_author
          INNER JOIN ijpass_journals.manuscript_author_tbl authorship
            ON authorship.author_data_id=source_author.author_data_id
          SET source_author.department_designation=${departmentDesignation || null}
          WHERE authorship.author_profile_id=${id}`);
        return updated;
      });
      if (!result)
        return res.status(404).json({ message: "Author profile not found" });
      return res.json({ message: "Author profile updated successfully" });
    } catch (error) {
      next(error);
    }
  },
);
app.delete(
  "/api/admin/author-profiles/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [{ links }] = await prisma.$queryRaw<Array<{ links: bigint }>>(
        Prisma.sql`SELECT COUNT(*) links FROM ijpass_journals.manuscript_author_tbl WHERE author_profile_id=${id}`,
      );
      if (Number(links))
        return res
          .status(409)
          .json({
            message:
              "This author cannot be deleted while manuscripts are linked.",
          });
      const result = await prisma.$executeRaw(
        Prisma.sql`DELETE FROM ijpass_journals.author_profile_tbl WHERE author_profile_id=${id}`,
      );
      if (!result)
        return res.status(404).json({ message: "Author profile not found" });
      return res.json({ message: "Author profile deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/author-merge-requests",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z.object({
        q: z.string().trim().max(150).catch(""),
        page: z.coerce.number().int().positive().catch(1),
      }).parse(req.query), pageSize = 20;
      const search = input.q
        ? Prisma.sql`WHERE reference LIKE ${`%${input.q}%`} OR requestedName LIKE ${`%${input.q}%`} OR status LIKE ${`%${input.q}%`}`
        : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) total FROM AuthorMergeRequest ${search}`,
      );
      const totalRecords = Number(total),
        totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
        page = Math.min(input.page, totalPages),
        offset = (page - 1) * pageSize;
      const requests = await prisma.$queryRaw<Array<{
        id: number;
        reference: string;
        requestedName: string;
        authorIds: unknown;
        status: string;
        canonicalAuthorId: number | null;
        createdAt: Date;
        reviewedAt: Date | null;
      }>>(Prisma.sql`
        SELECT id,reference,requestedName,authorIds,status,canonicalAuthorId,createdAt,reviewedAt
        FROM AuthorMergeRequest ${search} ORDER BY createdAt DESC
        LIMIT ${pageSize} OFFSET ${offset}`);
      return res.json({
        requests: requests.map((request) => ({
          ...request,
          authorIds: parseAuthorIds(request.authorIds),
          profileCount: parseAuthorIds(request.authorIds).length,
        })),
        page,
        totalPages,
        totalRecords,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/author-merge-requests/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [request] = await prisma.$queryRaw<Array<{
        id: number;
        reference: string;
        requestedName: string;
        authorIds: unknown;
        status: string;
        canonicalAuthorId: number | null;
        createdAt: Date;
        reviewedAt: Date | null;
      }>>(Prisma.sql`
        SELECT id,reference,requestedName,authorIds,status,canonicalAuthorId,createdAt,reviewedAt
        FROM AuthorMergeRequest WHERE id=${id}`);
      if (!request) return res.status(404).json({ message: "Author merge request not found" });
      const authorIds = parseAuthorIds(request.authorIds),
        profiles = await getMergeAuthorProfiles(authorIds);
      return res.json({ request: { ...request, authorIds, profiles } });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/author-merge-requests/:id/approve",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req: AuthRequest, res, next) => {
    try {
      const requestId = z.coerce.number().int().positive().parse(req.params.id),
        submitted = authorMergeApprovalSchema.parse(req.body),
        submittedIds = [...new Set(submitted.authorIds)].sort((a, b) => a - b);
      const result = await prisma.$transaction(async (tx) => {
        const [request] = await tx.$queryRaw<Array<{ status: string; authorIds: unknown }>>(
          Prisma.sql`SELECT status,authorIds FROM AuthorMergeRequest WHERE id=${requestId} FOR UPDATE`,
        );
        if (!request) throw Object.assign(new Error("Author merge request not found"), { statusCode: 404 });
        if (request.status !== "PENDING") throw Object.assign(new Error("Only pending requests can be approved"), { statusCode: 409 });
        const requestedIds = parseAuthorIds(request.authorIds);
        if (submittedIds.length < 2 || submittedIds.some((id) => !requestedIds.includes(id)))
          throw Object.assign(new Error("Select at least two profiles contained in this merge request"), { statusCode: 400 });
        if (!submittedIds.includes(submitted.canonicalAuthorId))
          throw Object.assign(new Error("Select a merge destination from the profiles being merged"), { statusCode: 400 });
        const profiles = await tx.$queryRaw<Array<{ id: bigint; name: string }>>(
          Prisma.sql`SELECT author_profile_id id,author_name name FROM ijpass_journals.author_profile_tbl WHERE author_profile_id IN (${Prisma.join(submittedIds)}) ORDER BY author_profile_id FOR UPDATE`,
        );
        if (profiles.length !== submittedIds.length)
          throw Object.assign(new Error("One or more selected profiles have already been removed"), { statusCode: 409 });
        if (new Set(profiles.map((profile) => normalizeMergeName(profile.name))).size !== 1)
          throw Object.assign(new Error("The selected profiles do not have the same author name"), { statusCode: 400 });
        const canonicalAuthorId = submitted.canonicalAuthorId,
          duplicateIds = submittedIds.filter((id) => id !== canonicalAuthorId);
        await tx.$executeRaw(Prisma.sql`
          INSERT IGNORE INTO ijpass_journals.author_affiliation_tbl
            (author_profile_id,affiliation_id,start_year,end_year,is_current,created_at,updated_at)
          SELECT ${canonicalAuthorId},affiliation_id,start_year,end_year,is_current,created_at,updated_at
          FROM ijpass_journals.author_affiliation_tbl
          WHERE author_profile_id IN (${Prisma.join(duplicateIds)})`);
        await tx.$executeRaw(Prisma.sql`
          UPDATE ijpass_journals.author_source_map_tbl
          SET author_profile_id=${canonicalAuthorId}
          WHERE author_profile_id IN (${Prisma.join(duplicateIds)})`);
        await tx.$executeRaw(Prisma.sql`
          UPDATE ijpass_journals.manuscript_tbl
          SET primary_author_profile_id=${canonicalAuthorId}
          WHERE primary_author_profile_id IN (${Prisma.join(duplicateIds)})`);
        for (const duplicateId of duplicateIds) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE ijpass_journals.manuscript_author_tbl linked
            LEFT JOIN ijpass_journals.manuscript_author_tbl canonical
              ON canonical.manuscript_id=linked.manuscript_id
              AND canonical.author_profile_id=${canonicalAuthorId}
            SET linked.author_profile_id=${canonicalAuthorId}
            WHERE linked.author_profile_id=${duplicateId}
              AND canonical.author_profile_id IS NULL`);
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM ijpass_journals.manuscript_author_tbl
            WHERE author_profile_id=${duplicateId}`);
        }
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM ijpass_journals.author_profile_tbl
          WHERE author_profile_id IN (${Prisma.join(duplicateIds)})`);
        await tx.$executeRaw(Prisma.sql`
          UPDATE AuthorMergeRequest SET status='APPROVED',canonicalAuthorId=${canonicalAuthorId},
            reviewedById=${req.auth!.id},reviewedAt=NOW() WHERE id=${requestId}`);
        return { canonicalAuthorId, duplicateIds };
      });
      await removeAuthorSearchDocuments(result.duplicateIds);
      return res.json({
        message: `Profiles merged successfully into Author ID ${result.canonicalAuthorId}.`,
        canonicalAuthorId: result.canonicalAuthorId,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/affiliation-merge-requests",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z.object({ q: z.string().trim().max(150).catch(""), page: z.coerce.number().int().positive().catch(1) }).parse(req.query),
        pageSize = 20,
        search = input.q ? Prisma.sql`WHERE reference LIKE ${`%${input.q}%`} OR requestedName LIKE ${`%${input.q}%`} OR status LIKE ${`%${input.q}%`}` : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) total FROM AffiliationMergeRequest ${search}`),
        totalRecords = Number(total), totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
        page = Math.min(input.page, totalPages), offset = (page - 1) * pageSize;
      const requests = await prisma.$queryRaw<Array<{ id: number; reference: string; requestedName: string; affiliationIds: unknown; status: string; canonicalAffiliationId: number | null; createdAt: Date; reviewedAt: Date | null }>>(Prisma.sql`
        SELECT id,reference,requestedName,affiliationIds,status,canonicalAffiliationId,createdAt,reviewedAt
        FROM AffiliationMergeRequest ${search} ORDER BY createdAt DESC LIMIT ${pageSize} OFFSET ${offset}`);
      return res.json({ requests: requests.map((request) => ({ ...request, affiliationIds: parseAuthorIds(request.affiliationIds), profileCount: parseAuthorIds(request.affiliationIds).length })), page, totalPages, totalRecords });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/affiliation-merge-requests/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [request] = await prisma.$queryRaw<Array<{ id: number; reference: string; requestedName: string; affiliationIds: unknown; status: string; canonicalAffiliationId: number | null; createdAt: Date; reviewedAt: Date | null }>>(Prisma.sql`
        SELECT id,reference,requestedName,affiliationIds,status,canonicalAffiliationId,createdAt,reviewedAt FROM AffiliationMergeRequest WHERE id=${id}`);
      if (!request) return res.status(404).json({ message: "Affiliation merge request not found" });
      const affiliationIds = parseAuthorIds(request.affiliationIds), profiles = await getMergeAffiliationProfiles(affiliationIds);
      return res.json({ request: { ...request, affiliationIds, profiles } });
    } catch (error) { next(error); }
  },
);

app.post(
  "/api/admin/affiliation-merge-requests/:id/approve",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req: AuthRequest, res, next) => {
    try {
      const requestId = z.coerce.number().int().positive().parse(req.params.id),
        submitted = affiliationMergeApprovalSchema.parse(req.body),
        submittedIds = [...new Set(submitted.affiliationIds)].sort((a, b) => a - b);
      const result = await prisma.$transaction(async (tx) => {
        const [request] = await tx.$queryRaw<Array<{ status: string; affiliationIds: unknown }>>(Prisma.sql`SELECT status,affiliationIds FROM AffiliationMergeRequest WHERE id=${requestId} FOR UPDATE`);
        if (!request) throw Object.assign(new Error("Affiliation merge request not found"), { statusCode: 404 });
        if (request.status !== "PENDING") throw Object.assign(new Error("Only pending requests can be approved"), { statusCode: 409 });
        const requestedIds = parseAuthorIds(request.affiliationIds);
        if (submittedIds.length < 2 || submittedIds.some((id) => !requestedIds.includes(id)))
          throw Object.assign(new Error("Select at least two affiliations contained in this merge request"), { statusCode: 400 });
        if (!submittedIds.includes(submitted.canonicalAffiliationId))
          throw Object.assign(new Error("Select a merge destination from the affiliations being merged"), { statusCode: 400 });
        const profiles = await tx.$queryRaw<Array<{ id: bigint; name: string; country: string }>>(Prisma.sql`
          SELECT affiliation_id id,university_company name,country FROM ijpass_journals.affiliationdata_tbl
          WHERE affiliation_id IN (${Prisma.join(submittedIds)}) ORDER BY affiliation_id FOR UPDATE`);
        if (profiles.length !== submittedIds.length)
          throw Object.assign(new Error("One or more selected affiliations have already been removed"), { statusCode: 409 });
        const canonicalAffiliationId = submitted.canonicalAffiliationId,
          canonical = profiles.find((profile) => Number(profile.id) === canonicalAffiliationId)!,
          duplicateIds = submittedIds.filter((id) => id !== canonicalAffiliationId),
          duplicateNames = profiles.filter((profile) => duplicateIds.includes(Number(profile.id))).map((profile) => profile.name);
        await tx.$executeRaw(Prisma.sql`
          INSERT IGNORE INTO ijpass_journals.author_affiliation_tbl
            (author_profile_id,affiliation_id,start_year,end_year,is_current,created_at,updated_at)
          SELECT author_profile_id,${canonicalAffiliationId},start_year,end_year,is_current,created_at,updated_at
          FROM ijpass_journals.author_affiliation_tbl WHERE affiliation_id IN (${Prisma.join(duplicateIds)})`);
        await tx.$executeRaw(Prisma.sql`DELETE FROM ijpass_journals.author_affiliation_tbl WHERE affiliation_id IN (${Prisma.join(duplicateIds)})`);
        if (duplicateNames.length)
          await tx.$executeRaw(Prisma.sql`
            UPDATE ijpass_journals.authordata_tbl SET university_company=${canonical.name},
              country=COALESCE(NULLIF(country,''),${canonical.country || null})
            WHERE TRIM(LEADING ', ' FROM TRIM(university_company)) IN (${Prisma.join(duplicateNames)})`);
        await tx.$executeRaw(Prisma.sql`DELETE FROM ijpass_journals.affiliationdata_tbl WHERE affiliation_id IN (${Prisma.join(duplicateIds)})`);
        await tx.$executeRaw(Prisma.sql`
          UPDATE AffiliationMergeRequest SET status='APPROVED',canonicalAffiliationId=${canonicalAffiliationId},reviewedById=${req.auth!.id},reviewedAt=NOW() WHERE id=${requestId}`);
        return { canonicalAffiliationId, duplicateIds };
      });
      await removeAffiliationSearchDocuments(result.duplicateIds);
      return res.json({ message: `Affiliations merged successfully into Affiliation ID ${result.canonicalAffiliationId}.`, canonicalAffiliationId: result.canonicalAffiliationId });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/affiliation-profiles",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z
          .object({
            q: z.string().trim().max(150).catch(""),
            page: z.coerce.number().int().positive().catch(1),
            sort: z
              .enum(["name", "newest", "country", "authors"])
              .catch("name"),
          })
          .parse(req.query),
        pageSize = 20;
      const search = input.q
        ? Prisma.sql`WHERE affiliation.university_company LIKE ${`%${input.q}%`} OR affiliation.city_territory LIKE ${`%${input.q}%`} OR affiliation.address LIKE ${`%${input.q}%`} OR affiliation.country LIKE ${`%${input.q}%`} OR CAST(affiliation.affiliation_id AS CHAR) LIKE ${`%${input.q}%`}`
        : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) total FROM ijpass_journals.affiliationdata_tbl affiliation ${search}`,
      );
      const totalRecords = Number(total),
        totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
        page = Math.min(input.page, totalPages),
        offset = (page - 1) * pageSize;
      const order =
        input.sort === "newest"
          ? Prisma.sql`affiliation.affiliation_id DESC`
          : input.sort === "country"
            ? Prisma.sql`affiliation.country ASC,affiliation.university_company ASC`
            : input.sort === "authors"
              ? Prisma.sql`authorCount DESC,affiliation.university_company ASC`
              : Prisma.sql`affiliation.university_company ASC`;
      const records = await prisma.$queryRaw<
        Array<{
          id: bigint;
          universityCompany: string;
          cityTerritory: string;
          address: string;
          country: string;
          authorCount: bigint;
        }>
      >(
        Prisma.sql`SELECT affiliation.affiliation_id id,affiliation.university_company universityCompany,affiliation.city_territory cityTerritory,affiliation.address,affiliation.country,COUNT(DISTINCT link.author_profile_id) authorCount FROM ijpass_journals.affiliationdata_tbl affiliation LEFT JOIN ijpass_journals.author_affiliation_tbl link ON link.affiliation_id=affiliation.affiliation_id ${search} GROUP BY affiliation.affiliation_id,affiliation.university_company,affiliation.city_territory,affiliation.address,affiliation.country ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
      );
      return res.json({
        profiles: records.map((record) => ({
          ...record,
          id: Number(record.id),
          authorCount: Number(record.authorCount),
        })),
        page,
        totalPages,
        totalRecords,
      });
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/admin/affiliation-profiles/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [profile] = await prisma.$queryRaw<
        Array<{
          id: bigint;
          universityCompany: string;
          cityTerritory: string;
          address: string;
          country: string;
        }>
      >(
        Prisma.sql`SELECT affiliation_id id,university_company universityCompany,city_territory cityTerritory,address,country FROM ijpass_journals.affiliationdata_tbl WHERE affiliation_id=${id}`,
      );
      if (!profile)
        return res
          .status(404)
          .json({ message: "Affiliation profile not found" });
      return res.json({ profile: { ...profile, id: Number(profile.id) } });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/admin/affiliation-profiles",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = affiliationProfileSchema.parse(req.body);
      const [duplicate] = await prisma.$queryRaw<Array<{ id: bigint }>>(
        Prisma.sql`SELECT affiliation_id id FROM ijpass_journals.affiliationdata_tbl WHERE university_company=${input.universityCompany} AND address=${input.address || ""} AND country=${input.country || ""} LIMIT 1`,
      );
      if (duplicate)
        return res.status(409).json({
          message: `This affiliation already exists as Affiliation ID ${Number(duplicate.id)}. Use an Affiliation Merge Request instead of creating a duplicate.`,
          duplicateAffiliationId: Number(duplicate.id),
        });
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO ijpass_journals.affiliationdata_tbl(university_company,city_territory,address,country) VALUES(${input.universityCompany},${input.cityTerritory || ""},${input.address || ""},${input.country || ""})`,
      );
      return res
        .status(201)
        .json({ message: "Affiliation profile added successfully" });
    } catch (error) {
      next(error);
    }
  },
);
app.put(
  "/api/admin/affiliation-profiles/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id),
        input = affiliationProfileSchema.parse(req.body);
      const [duplicate] = await prisma.$queryRaw<Array<{ id: bigint }>>(
        Prisma.sql`SELECT affiliation_id id FROM ijpass_journals.affiliationdata_tbl WHERE university_company=${input.universityCompany} AND address=${input.address || ""} AND country=${input.country || ""} AND affiliation_id<>${id} LIMIT 1`,
      );
      if (duplicate)
        return res.status(409).json({
          message: `These affiliation details already belong to Affiliation ID ${Number(duplicate.id)}. Submit an Affiliation Merge Request to combine the records.`,
          duplicateAffiliationId: Number(duplicate.id),
        });
      const result = await prisma.$executeRaw(
        Prisma.sql`UPDATE ijpass_journals.affiliationdata_tbl SET university_company=${input.universityCompany},city_territory=${input.cityTerritory || ""},address=${input.address || ""},country=${input.country || ""} WHERE affiliation_id=${id}`,
      );
      if (!result)
        return res
          .status(404)
          .json({ message: "Affiliation profile not found" });
      return res.json({ message: "Affiliation profile updated successfully" });
    } catch (error) {
      next(error);
    }
  },
);
app.delete(
  "/api/admin/affiliation-profiles/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [{ links }] = await prisma.$queryRaw<Array<{ links: bigint }>>(
        Prisma.sql`SELECT COUNT(*) links FROM ijpass_journals.author_affiliation_tbl WHERE affiliation_id=${id}`,
      );
      if (Number(links))
        return res
          .status(409)
          .json({
            message:
              "This affiliation cannot be deleted while authors are linked.",
          });
      const result = await prisma.$executeRaw(
        Prisma.sql`DELETE FROM ijpass_journals.affiliationdata_tbl WHERE affiliation_id=${id}`,
      );
      if (!result)
        return res
          .status(404)
          .json({ message: "Affiliation profile not found" });
      return res.json({ message: "Affiliation profile deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/subject-hierarchy/options",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req, res, next) => {
    try {
      const [majorSubjects, classifications] = await Promise.all([
        prisma.$queryRaw<Array<{ id: bigint; majorSubject: string }>>(Prisma.sql`
          SELECT major_subject_id id,major_subject majorSubject
          FROM ijpass_journals.major_subject_tbl ORDER BY major_subject`),
        prisma.$queryRaw<Array<{ id: bigint; majorSubjectId: bigint; classificationName: string }>>(Prisma.sql`
          SELECT classification_id id,major_subject_id majorSubjectId,
            classification_name classificationName
          FROM ijpass_journals.subject_classification_tbl
          ORDER BY classification_name`),
      ]);
      return res.json({
        majorSubjects: majorSubjects.map((record) => ({ ...record, id: Number(record.id) })),
        classifications: classifications.map((record) => ({
          ...record,
          id: Number(record.id),
          majorSubjectId: Number(record.majorSubjectId),
        })),
      });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/major-subjects",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z.object({
        q: z.string().trim().max(150).catch(""),
        page: z.coerce.number().int().positive().catch(1),
        sort: z.enum(["name", "newest"]).catch("name"),
      }).parse(req.query);
      const pageSize = 20;
      const where = input.q
        ? Prisma.sql`WHERE major.major_subject LIKE ${`%${input.q}%`} OR CAST(major.major_subject_id AS CHAR) LIKE ${`%${input.q}%`}`
        : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) total FROM ijpass_journals.major_subject_tbl major ${where}`);
      const totalRecords = Number(total);
      const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
      const page = Math.min(input.page, totalPages);
      const offset = (page - 1) * pageSize;
      const order = input.sort === "newest" ? Prisma.sql`major.major_subject_id DESC` : Prisma.sql`major.major_subject`;
      const records = await prisma.$queryRaw<Array<{
        id: bigint;
        majorSubject: string;
        classificationCount: bigint;
        subjectAreaCount: bigint;
      }>>(Prisma.sql`
        SELECT major.major_subject_id id,major.major_subject majorSubject,
          COUNT(DISTINCT classification.classification_id) classificationCount,
          COUNT(DISTINCT subject.subject_area_id) subjectAreaCount
        FROM ijpass_journals.major_subject_tbl major
        LEFT JOIN ijpass_journals.subject_classification_tbl classification
          ON classification.major_subject_id=major.major_subject_id
        LEFT JOIN ijpass_journals.subject_area_tbl subject
          ON subject.classification_id=classification.classification_id
        ${where}
        GROUP BY major.major_subject_id,major.major_subject
        ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`);
      return res.json({
        records: records.map((record) => ({
          ...record,
          id: Number(record.id),
          classificationCount: Number(record.classificationCount),
          subjectAreaCount: Number(record.subjectAreaCount),
        })),
        pagination: { page, pageSize, totalRecords, totalPages },
      });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/major-subjects/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [record] = await prisma.$queryRaw<Array<{ id: bigint; majorSubject: string }>>(Prisma.sql`
        SELECT major_subject_id id,major_subject majorSubject
        FROM ijpass_journals.major_subject_tbl WHERE major_subject_id=${id}`);
      if (!record) return res.status(404).json({ message: "Major subject not found" });
      return res.json({ record: { ...record, id: Number(record.id) } });
    } catch (error) { next(error); }
  },
);

app.post(
  "/api/admin/major-subjects",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = majorSubjectSchema.parse(req.body);
      const [existing] = await prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
        SELECT major_subject_id id FROM ijpass_journals.major_subject_tbl
        WHERE major_subject=${input.majorSubject} LIMIT 1`);
      if (existing) return res.status(409).json({ message: "This major subject already exists." });
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ijpass_journals.major_subject_tbl (major_subject) VALUES (${input.majorSubject})`);
      return res.status(201).json({ message: "Major subject added successfully" });
    } catch (error) { next(error); }
  },
);

app.put(
  "/api/admin/major-subjects/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = majorSubjectSchema.parse(req.body);
      const [duplicate] = await prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
        SELECT major_subject_id id FROM ijpass_journals.major_subject_tbl
        WHERE major_subject=${input.majorSubject} AND major_subject_id<>${id} LIMIT 1`);
      if (duplicate) return res.status(409).json({ message: "This major subject already exists." });
      const updated = await prisma.$transaction(async (transaction) => {
        const count = await transaction.$executeRaw(Prisma.sql`
          UPDATE ijpass_journals.major_subject_tbl
          SET major_subject=${input.majorSubject} WHERE major_subject_id=${id}`);
        if (!count) return 0;
        await transaction.$executeRaw(Prisma.sql`
          UPDATE ijpass_journals.subject_area_tbl subject
          INNER JOIN ijpass_journals.subject_classification_tbl classification
            ON classification.classification_id=subject.classification_id
          SET subject.major_subject=${input.majorSubject}
          WHERE classification.major_subject_id=${id}`);
        await transaction.$executeRawUnsafe(`
          UPDATE ijpass_journals.subject_area_tbl subject
          INNER JOIN ijpass_journals.subject_classification_tbl classification
            ON classification.classification_id=subject.classification_id
          SET subject.record_key=SHA2(LOWER(CONCAT(subject.major_subject,CHAR(0),subject.classification_name,CHAR(0),subject.subject_area)),256)
          WHERE classification.major_subject_id=?`, id);
        return count;
      });
      if (!updated) return res.status(404).json({ message: "Major subject not found" });
      return res.json({ message: "Major subject updated successfully" });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/subject-classifications",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z.object({
        q: z.string().trim().max(150).catch(""),
        page: z.coerce.number().int().positive().catch(1),
        sort: z.enum(["classification", "major", "newest"]).catch("classification"),
      }).parse(req.query);
      const pageSize = 20;
      const where = input.q
        ? Prisma.sql`WHERE classification.classification_name LIKE ${`%${input.q}%`} OR major.major_subject LIKE ${`%${input.q}%`} OR CAST(classification.classification_id AS CHAR) LIKE ${`%${input.q}%`}`
        : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) total
        FROM ijpass_journals.subject_classification_tbl classification
        INNER JOIN ijpass_journals.major_subject_tbl major
          ON major.major_subject_id=classification.major_subject_id ${where}`);
      const totalRecords = Number(total);
      const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
      const page = Math.min(input.page, totalPages);
      const offset = (page - 1) * pageSize;
      const order = input.sort === "major"
        ? Prisma.sql`major.major_subject,classification.classification_name`
        : input.sort === "newest"
          ? Prisma.sql`classification.classification_id DESC`
          : Prisma.sql`classification.classification_name,major.major_subject`;
      const records = await prisma.$queryRaw<Array<{
        id: bigint;
        majorSubjectId: bigint;
        majorSubject: string;
        classificationName: string;
        subjectAreaCount: bigint;
      }>>(Prisma.sql`
        SELECT classification.classification_id id,
          classification.major_subject_id majorSubjectId,
          major.major_subject majorSubject,
          classification.classification_name classificationName,
          COUNT(subject.subject_area_id) subjectAreaCount
        FROM ijpass_journals.subject_classification_tbl classification
        INNER JOIN ijpass_journals.major_subject_tbl major
          ON major.major_subject_id=classification.major_subject_id
        LEFT JOIN ijpass_journals.subject_area_tbl subject
          ON subject.classification_id=classification.classification_id
        ${where}
        GROUP BY classification.classification_id,classification.major_subject_id,
          major.major_subject,classification.classification_name
        ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`);
      return res.json({
        records: records.map((record) => ({
          ...record,
          id: Number(record.id),
          majorSubjectId: Number(record.majorSubjectId),
          subjectAreaCount: Number(record.subjectAreaCount),
        })),
        pagination: { page, pageSize, totalRecords, totalPages },
      });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/subject-classifications/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [record] = await prisma.$queryRaw<Array<{
        id: bigint;
        majorSubjectId: bigint;
        majorSubject: string;
        classificationName: string;
      }>>(Prisma.sql`
        SELECT classification.classification_id id,
          classification.major_subject_id majorSubjectId,
          major.major_subject majorSubject,
          classification.classification_name classificationName
        FROM ijpass_journals.subject_classification_tbl classification
        INNER JOIN ijpass_journals.major_subject_tbl major
          ON major.major_subject_id=classification.major_subject_id
        WHERE classification.classification_id=${id}`);
      if (!record) return res.status(404).json({ message: "Classification not found" });
      return res.json({ record: { ...record, id: Number(record.id), majorSubjectId: Number(record.majorSubjectId) } });
    } catch (error) { next(error); }
  },
);

app.post(
  "/api/admin/subject-classifications",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = subjectClassificationSchema.parse(req.body);
      const [major] = await prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
        SELECT major_subject_id id FROM ijpass_journals.major_subject_tbl
        WHERE major_subject_id=${input.majorSubjectId}`);
      if (!major) return res.status(400).json({ message: "Select a valid major subject." });
      const [existing] = await prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
        SELECT classification_id id FROM ijpass_journals.subject_classification_tbl
        WHERE major_subject_id=${input.majorSubjectId}
          AND classification_name=${input.classificationName} LIMIT 1`);
      if (existing) return res.status(409).json({ message: "This classification already exists under the selected major subject." });
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ijpass_journals.subject_classification_tbl
          (major_subject_id,classification_name)
        VALUES (${input.majorSubjectId},${input.classificationName})`);
      return res.status(201).json({ message: "Classification added successfully" });
    } catch (error) { next(error); }
  },
);

app.put(
  "/api/admin/subject-classifications/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = subjectClassificationSchema.parse(req.body);
      const [major] = await prisma.$queryRaw<Array<{ id: bigint; majorSubject: string }>>(Prisma.sql`
        SELECT major_subject_id id,major_subject majorSubject
        FROM ijpass_journals.major_subject_tbl WHERE major_subject_id=${input.majorSubjectId}`);
      if (!major) return res.status(400).json({ message: "Select a valid major subject." });
      const [duplicate] = await prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
        SELECT classification_id id FROM ijpass_journals.subject_classification_tbl
        WHERE major_subject_id=${input.majorSubjectId}
          AND classification_name=${input.classificationName}
          AND classification_id<>${id} LIMIT 1`);
      if (duplicate) return res.status(409).json({ message: "This classification already exists under the selected major subject." });
      const updated = await prisma.$transaction(async (transaction) => {
        const count = await transaction.$executeRaw(Prisma.sql`
          UPDATE ijpass_journals.subject_classification_tbl
          SET major_subject_id=${input.majorSubjectId},classification_name=${input.classificationName}
          WHERE classification_id=${id}`);
        if (!count) return 0;
        await transaction.$executeRaw(Prisma.sql`
          UPDATE ijpass_journals.subject_area_tbl
          SET major_subject=${major.majorSubject},classification_name=${input.classificationName}
          WHERE classification_id=${id}`);
        await transaction.$executeRawUnsafe(`
          UPDATE ijpass_journals.subject_area_tbl
          SET record_key=SHA2(LOWER(CONCAT(major_subject,CHAR(0),classification_name,CHAR(0),subject_area)),256)
          WHERE classification_id=?`, id);
        return count;
      });
      if (!updated) return res.status(404).json({ message: "Classification not found" });
      return res.json({ message: "Classification updated successfully" });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/subject-areas",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z.object({
        q: z.string().trim().max(150).catch(""),
        page: z.coerce.number().int().positive().catch(1),
        sort: z.enum(["subject", "major", "classification", "newest"]).catch("subject"),
      }).parse(req.query);
      const pageSize = 20;
      const where = input.q
        ? Prisma.sql`WHERE major_subject LIKE ${`%${input.q}%`} OR classification_name LIKE ${`%${input.q}%`} OR subject_area LIKE ${`%${input.q}%`} OR CAST(subject_area_id AS CHAR) LIKE ${`%${input.q}%`}`
        : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) total FROM ijpass_journals.subject_area_tbl ${where}`,
      );
      const totalRecords = Number(total);
      const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
      const page = Math.min(input.page, totalPages);
      const offset = (page - 1) * pageSize;
      const order = input.sort === "major"
        ? Prisma.sql`major_subject,classification_name,subject_area`
        : input.sort === "classification"
          ? Prisma.sql`classification_name,subject_area,major_subject`
          : input.sort === "newest"
            ? Prisma.sql`subject_area_id DESC`
            : Prisma.sql`subject_area,classification_name,major_subject`;
      const records = await prisma.$queryRaw<Array<{
        id: bigint;
        majorSubject: string;
        classificationName: string;
        subjectArea: string;
      }>>(Prisma.sql`
        SELECT subject_area_id id,major_subject majorSubject,
          classification_name classificationName,subject_area subjectArea
        FROM ijpass_journals.subject_area_tbl ${where}
        ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`);
      return res.json({
        records: records.map((record) => ({ ...record, id: Number(record.id) })),
        pagination: { page, pageSize, totalRecords, totalPages },
      });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/subject-areas/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [record] = await prisma.$queryRaw<Array<{
        id: bigint;
        classificationId: bigint;
        majorSubjectId: bigint;
        majorSubject: string;
        classificationName: string;
        subjectArea: string;
      }>>(Prisma.sql`
        SELECT subject.subject_area_id id,subject.classification_id classificationId,
          classification.major_subject_id majorSubjectId,
          subject.major_subject majorSubject,
          subject.classification_name classificationName,subject.subject_area subjectArea
        FROM ijpass_journals.subject_area_tbl subject
        INNER JOIN ijpass_journals.subject_classification_tbl classification
          ON classification.classification_id=subject.classification_id
        WHERE subject.subject_area_id=${id}`);
      if (!record) return res.status(404).json({ message: "Subject area not found" });
      return res.json({ record: {
        ...record,
        id: Number(record.id),
        classificationId: Number(record.classificationId),
        majorSubjectId: Number(record.majorSubjectId),
      } });
    } catch (error) { next(error); }
  },
);

app.post(
  "/api/admin/subject-areas",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = subjectAreaSchema.parse(req.body);
      const [classification] = await prisma.$queryRaw<Array<{
        classificationName: string;
        majorSubject: string;
      }>>(Prisma.sql`
        SELECT classification.classification_name classificationName,
          major.major_subject majorSubject
        FROM ijpass_journals.subject_classification_tbl classification
        INNER JOIN ijpass_journals.major_subject_tbl major
          ON major.major_subject_id=classification.major_subject_id
        WHERE classification.classification_id=${input.classificationId}`);
      if (!classification) return res.status(400).json({ message: "Select a valid classification." });
      const recordKey = subjectAreaRecordKey({ ...classification, subjectArea: input.subjectArea });
      const [existing] = await prisma.$queryRaw<Array<{ id: bigint }>>(
        Prisma.sql`SELECT subject_area_id id FROM ijpass_journals.subject_area_tbl WHERE record_key=${recordKey} LIMIT 1`,
      );
      if (existing) return res.status(409).json({ message: "This subject area record already exists." });
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ijpass_journals.subject_area_tbl
          (record_key,classification_id,major_subject,classification_name,subject_area)
        VALUES (${recordKey},${input.classificationId},${classification.majorSubject},${classification.classificationName},${input.subjectArea})`);
      return res.status(201).json({ message: "Subject area added successfully" });
    } catch (error) { next(error); }
  },
);

app.put(
  "/api/admin/subject-areas/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = subjectAreaSchema.parse(req.body);
      const [classification] = await prisma.$queryRaw<Array<{
        classificationName: string;
        majorSubject: string;
      }>>(Prisma.sql`
        SELECT classification.classification_name classificationName,
          major.major_subject majorSubject
        FROM ijpass_journals.subject_classification_tbl classification
        INNER JOIN ijpass_journals.major_subject_tbl major
          ON major.major_subject_id=classification.major_subject_id
        WHERE classification.classification_id=${input.classificationId}`);
      if (!classification) return res.status(400).json({ message: "Select a valid classification." });
      const recordKey = subjectAreaRecordKey({ ...classification, subjectArea: input.subjectArea });
      const [duplicate] = await prisma.$queryRaw<Array<{ id: bigint }>>(
        Prisma.sql`SELECT subject_area_id id FROM ijpass_journals.subject_area_tbl WHERE record_key=${recordKey} AND subject_area_id<>${id} LIMIT 1`,
      );
      if (duplicate) return res.status(409).json({ message: "This subject area record already exists." });
      const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE ijpass_journals.subject_area_tbl
        SET record_key=${recordKey},classification_id=${input.classificationId},
          major_subject=${classification.majorSubject},
          classification_name=${classification.classificationName},subject_area=${input.subjectArea}
        WHERE subject_area_id=${id}`);
      if (!updated) return res.status(404).json({ message: "Subject area not found" });
      return res.json({ message: "Subject area updated successfully" });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/journal-publishers",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req, res, next) => {
    try {
      const records = await prisma.$queryRaw<
        Array<{
          id: number;
          publisherName: string;
          chiefEditor: string | null;
          email: string | null;
          website: string | null;
          address: string | null;
          country: string | null;
          active: number;
          sourceCount: bigint;
        }>
      >(Prisma.sql`
      SELECT publisher.publisher_id AS id, publisher.publisher_name AS publisherName,
        publisher.chief_editor AS chiefEditor, publisher.email, publisher.website, publisher.address, publisher.country,
        COALESCE(publisher.active,1) AS active,
        COUNT(source.source_data_id) AS sourceCount
      FROM ijpass_journals.publisher_tbl publisher
      LEFT JOIN ijpass_journals.sourcedata_tbl source ON source.publisher_id = publisher.publisher_id
      GROUP BY publisher.publisher_id, publisher.publisher_name, publisher.chief_editor, publisher.email, publisher.website, publisher.address, publisher.country, publisher.active
      ORDER BY publisher.publisher_name
    `);
      return res.json({
        publishers: records.map((record) => ({
          ...record,
          id: Number(record.id),
          active: Number(record.active) === 1,
          sourceCount: Number(record.sourceCount),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/journal-publishers",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = journalPublisherSchema.parse(req.body);
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO ijpass_journals.publisher_tbl (publisher_name, chief_editor, email, website, address, country, active) VALUES (${input.publisherName}, ${input.chiefEditor || null}, ${input.email || null}, ${input.website || null}, ${input.address || null}, ${input.country || null}, ${input.active ? 1 : 0})`,
      );
      return res.status(201).json({ message: "Publisher added successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/journal-publishers/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = journalPublisherSchema.parse(req.body);
      const result = await prisma.$executeRaw(
        Prisma.sql`UPDATE ijpass_journals.publisher_tbl SET publisher_name=${input.publisherName}, chief_editor=${input.chiefEditor || null}, email=${input.email || null}, website=${input.website || null}, address=${input.address || null}, country=${input.country || null}, active=${input.active ? 1 : 0} WHERE publisher_id=${id}`,
      );
      if (!result)
        return res.status(404).json({ message: "Publisher not found" });
      await prisma.$executeRaw(
        Prisma.sql`UPDATE ijpass_journals.sourcedata_tbl SET publisher=${input.publisherName} WHERE publisher_id=${id}`,
      );
      return res.json({ message: "Publisher updated successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/journal-publishers/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [{ sourceCount }] = await prisma.$queryRaw<
        Array<{ sourceCount: bigint }>
      >(
        Prisma.sql`SELECT COUNT(*) sourceCount FROM ijpass_journals.sourcedata_tbl WHERE publisher_id=${id}`,
      );
      if (Number(sourceCount))
        return res
          .status(409)
          .json({
            message:
              "This publisher cannot be deleted while sources are linked to it.",
          });
      const result = await prisma.$executeRaw(
        Prisma.sql`DELETE FROM ijpass_journals.publisher_tbl WHERE publisher_id=${id}`,
      );
      if (!result)
        return res.status(404).json({ message: "Publisher not found" });
      return res.json({ message: "Publisher deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/sources",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z.object({
        q: z.string().trim().max(255).catch(""),
        page: z.coerce.number().int().positive().catch(1),
        sort: z.enum(["newest", "title", "publisher", "year", "articles", "citations"]).catch("newest"),
      }).parse(req.query);
      const pageSize = 20;
      const search = input.q ? Prisma.sql`WHERE source.journal_title LIKE ${`%${input.q}%`} OR source.abbreviation LIKE ${`%${input.q}%`} OR source.print_issn LIKE ${`%${input.q}%`} OR source.online_issn LIKE ${`%${input.q}%`} OR source.subject_area LIKE ${`%${input.q}%`} OR source.source_type LIKE ${`%${input.q}%`} OR source.publisher LIKE ${`%${input.q}%`} OR CAST(source.source_data_id AS CHAR) LIKE ${`%${input.q}%`}` : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) total FROM ijpass_journals.sourcedata_tbl source ${search}`,
      );
      const totalRecords = Number(total);
      const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
      const page = Math.min(input.page, totalPages);
      const offset = (page - 1) * pageSize;
      const order = input.sort === "title" ? Prisma.sql`source.journal_title ASC`
        : input.sort === "publisher" ? Prisma.sql`publisher ASC, source.journal_title ASC`
        : input.sort === "year" ? Prisma.sql`source.indexed_from_year DESC, source.source_data_id DESC`
        : input.sort === "articles" ? Prisma.sql`articleCount DESC, source.source_data_id DESC`
        : Prisma.sql`source.source_data_id DESC`;
      const records = await prisma.$queryRaw<
        Array<{
          id: bigint;
          journalId: number;
          journalTitle: string;
          abbreviation: string | null;
          printIssn: string | null;
          onlineIssn: string | null;
          subjectArea: string | null;
          sourceType: string | null;
          publisherId: number | null;
          publisher: string | null;
          active: number;
          indexedFromYear: number | null;
          website: string | null;
          email: string | null;
          articleCount: bigint;
          citationCount: bigint;
        }>
      >(Prisma.sql`
      SELECT source.source_data_id AS id, source.journal_id AS journalId, TRIM(source.journal_title) AS journalTitle,
        source.abbreviation, source.print_issn AS printIssn, source.online_issn AS onlineIssn,
        source.subject_area AS subjectArea, COALESCE(source.source_type, 'Journal') AS sourceType,
        source.publisher_id AS publisherId, COALESCE(publisher.publisher_name, source.publisher) AS publisher,
        COALESCE(source.active,1) AS active,
        source.indexed_from_year AS indexedFromYear, source.website, source.email,
        COUNT(manuscript.manuscript_id) AS articleCount, 0 AS citationCount
      FROM ijpass_journals.sourcedata_tbl AS source
      LEFT JOIN ijpass_journals.publisher_tbl AS publisher ON publisher.publisher_id = source.publisher_id
      LEFT JOIN ijpass_journals.manuscript_tbl AS manuscript ON manuscript.journal_id = source.source_data_id
      ${search}
      GROUP BY source.source_data_id, source.journal_id, source.journal_title, source.abbreviation, source.print_issn, source.online_issn, source.subject_area, source.source_type, source.publisher_id, publisher.publisher_name, source.publisher, source.active, source.indexed_from_year, source.website, source.email
      ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}
    `);
      const sourceIds = records.map((record) => Number(record.id));
      const citationRows = sourceIds.length ? await prisma.$queryRaw<Array<{ sourceId: bigint; citationCount: bigint }>>(
        Prisma.sql`SELECT cited_manuscript.journal_id sourceId,COUNT(*) citationCount FROM ijpass_journals.manuscript_tbl cited_manuscript INNER JOIN ijpass_journals.refdat_table matching_reference ON matching_reference.publication_year=cited_manuscript.publication_year AND REGEXP_REPLACE(LOWER(TRIM(matching_reference.article_title)),'[^[:alnum:]]+','')=REGEXP_REPLACE(LOWER(TRIM(cited_manuscript.article_title)),'[^[:alnum:]]+','') AND matching_reference.manuscript_id<>cited_manuscript.manuscript_id WHERE cited_manuscript.journal_id IN (${Prisma.join(sourceIds)}) GROUP BY cited_manuscript.journal_id`,
      ) : [];
      const citationMap = new Map(citationRows.map((row) => [Number(row.sourceId), Number(row.citationCount)]));
      const sources = records.map((record) => ({
        ...record,
        id: Number(record.id),
        active: Number(record.active) === 1,
        articleCount: Number(record.articleCount),
        citationCount: citationMap.get(Number(record.id)) ?? 0,
      }));
      if (input.sort === "citations") sources.sort((a, b) => b.citationCount - a.citationCount || b.id - a.id);
      return res.json({
        sources,
        page,
        totalPages,
        totalRecords,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/sources/export/:format",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const format = z.enum(["xlsx", "pdf"]).parse(req.params.format);
      const records = await prisma.$queryRaw<Array<{
        id: bigint;
        journalId: number;
        journalTitle: string;
        abbreviation: string | null;
        printIssn: string | null;
        onlineIssn: string | null;
        subjectArea: string | null;
        sourceType: string;
        publisher: string | null;
        indexedFromYear: number | null;
        website: string | null;
        email: string | null;
        active: number;
        articleCount: bigint;
        citationCount: bigint;
      }>>(Prisma.sql`
        SELECT source.source_data_id id,source.journal_id journalId,
          TRIM(source.journal_title) journalTitle,NULLIF(TRIM(source.abbreviation),'') abbreviation,
          NULLIF(TRIM(source.print_issn),'') printIssn,NULLIF(TRIM(source.online_issn),'') onlineIssn,
          NULLIF(TRIM(source.subject_area),'') subjectArea,
          COALESCE(NULLIF(TRIM(source.source_type),''),'Journal') sourceType,
          COALESCE(NULLIF(TRIM(publisher.publisher_name),''),NULLIF(TRIM(source.publisher),'')) publisher,
          source.indexed_from_year indexedFromYear,NULLIF(TRIM(source.website),'') website,
          NULLIF(TRIM(source.email),'') email,COALESCE(source.active,1) active,
          COUNT(DISTINCT manuscript.manuscript_id) articleCount,
          COALESCE(MAX(citation_totals.citation_count),0) citationCount
        FROM ijpass_journals.sourcedata_tbl source
        LEFT JOIN ijpass_journals.publisher_tbl publisher
          ON publisher.publisher_id=source.publisher_id
        LEFT JOIN ijpass_journals.manuscript_tbl manuscript
          ON manuscript.journal_id=source.source_data_id
        LEFT JOIN (
          SELECT cited_manuscript.journal_id,COUNT(*) citation_count
          FROM ijpass_journals.manuscript_tbl cited_manuscript
          INNER JOIN ijpass_journals.refdat_table matching_reference
            ON matching_reference.publication_year=cited_manuscript.publication_year
            AND REGEXP_REPLACE(LOWER(TRIM(matching_reference.article_title)),'[^[:alnum:]]+','')=
              REGEXP_REPLACE(LOWER(TRIM(cited_manuscript.article_title)),'[^[:alnum:]]+','')
            AND matching_reference.manuscript_id<>cited_manuscript.manuscript_id
          GROUP BY cited_manuscript.journal_id
        ) citation_totals ON citation_totals.journal_id=source.source_data_id
        GROUP BY source.source_data_id,source.journal_id,source.journal_title,source.abbreviation,
          source.print_issn,source.online_issn,source.subject_area,source.source_type,
          publisher.publisher_name,source.publisher,source.indexed_from_year,source.website,
          source.email,source.active
        ORDER BY source.journal_title,source.source_data_id`);

      const generatedAt = new Date();
      const dateLabel = generatedAt.toISOString().slice(0, 10);
      const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);

      if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "International Journal Publishers Association (IJPAss)";
        workbook.created = generatedAt;
        workbook.modified = generatedAt;
        workbook.subject = "Complete IJPAss resource directory";
        const worksheet = workbook.addWorksheet("All Resources", {
          views: [{ state: "frozen", ySplit: 5, activeCell: "A6" }],
          properties: { defaultRowHeight: 19 },
          pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        });
        const columns = [
          ["Sl. No.", 10], ["Resource ID", 13], ["Journal ID", 12], ["Resource Title", 52],
          ["Abbreviation", 17], ["Print ISSN", 15], ["Online ISSN", 15], ["Subject Area", 34],
          ["Resource Type", 24], ["Source Publisher", 30], ["Indexed From", 14], ["Status", 12],
          ["Articles", 12], ["Citations", 12], ["Website", 34], ["Email", 30],
        ] as const;
        worksheet.columns = columns.map(([, width]) => ({ width }));
        worksheet.mergeCells("A1:P1");
        worksheet.getCell("A1").value = "International Journal Publishers Association (IJPAss)";
        worksheet.getCell("A1").font = { name: "Aptos Display", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
        worksheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
        worksheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF073B4C" } };
        worksheet.getRow(1).height = 30;
        worksheet.mergeCells("A2:P2");
        worksheet.getCell("A2").value = "Complete Resource Directory";
        worksheet.getCell("A2").font = { name: "Aptos Display", size: 14, bold: true, color: { argb: "FF087F76" } };
        worksheet.getRow(2).height = 24;
        worksheet.mergeCells("A3:P3");
        worksheet.getCell("A3").value = `Generated: ${generatedAt.toLocaleString("en-IN")}  |  Total resources: ${records.length.toLocaleString("en-IN")}`;
        worksheet.getCell("A3").font = { name: "Aptos", size: 10, color: { argb: "FF536B75" } };
        worksheet.getRow(4).height = 8;
        const headingRow = worksheet.getRow(5);
        headingRow.values = columns.map(([label]) => label);
        headingRow.height = 28;
        headingRow.eachCell((cell) => {
          cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF087F76" } };
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          cell.border = { bottom: { style: "medium", color: { argb: "FF073B4C" } } };
        });
        for (const [index, record] of records.entries()) {
          const row = worksheet.addRow([
            index + 1, Number(record.id), record.journalId, record.journalTitle, record.abbreviation || "",
            record.printIssn || "", record.onlineIssn || "", record.subjectArea || "", record.sourceType,
            record.publisher || "", record.indexedFromYear || "", Number(record.active) === 1 ? "Enabled" : "Disabled",
            Number(record.articleCount), Number(record.citationCount), record.website || "", record.email || "",
          ]);
          row.height = 34;
          row.eachCell((cell, columnNumber) => {
            cell.font = { name: "Aptos", size: 9, color: { argb: "FF173A48" } };
            cell.alignment = {
              vertical: "middle",
              horizontal: [1, 2, 3, 11, 12, 13, 14].includes(columnNumber) ? "center" : "left",
              wrapText: true,
            };
            cell.border = { bottom: { style: "hair", color: { argb: "FFD8E4E7" } } };
            if (index % 2 === 1)
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F8F8" } };
          });
          row.getCell(4).font = { name: "Aptos", size: 9, bold: true, color: { argb: "FF173A48" } };
          row.getCell(12).font = { name: "Aptos", size: 9, bold: true, color: { argb: Number(record.active) === 1 ? "FF087F76" : "FFB42318" } };
          if (record.website) {
            const websiteCell = row.getCell(15);
            websiteCell.value = { text: record.website, hyperlink: record.website };
            websiteCell.font = { name: "Aptos", size: 9, color: { argb: "FF0563C1" }, underline: true };
          }
        }
        worksheet.autoFilter = { from: "A5", to: "P5" };
        worksheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };
        worksheet.headerFooter.oddFooter = "&LIJPAss Resource Directory&CPage &P of &N&R" + dateLabel;
        const output = await workbook.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="ijpass-resources-${dateLabel}.xlsx"`);
        res.setHeader("Cache-Control", "no-store");
        return res.send(Buffer.from(output));
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="ijpass-resources-${dateLabel}.pdf"`);
      res.setHeader("Cache-Control", "no-store");
      const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 28, bufferPages: true, info: {
        Title: "IJPAss Complete Resource Directory",
        Author: "International Journal Publishers Association (IJPAss)",
        Subject: "Complete indexed resource directory",
      } });
      document.on("error", next);
      document.pipe(res);
      const margin = 28;
      const pageWidth = document.page.width - margin * 2;
      const pdfColumns = [
        { key: "number", label: "No.", width: 24, align: "center" as const },
        { key: "id", label: "Resource ID", width: 42, align: "center" as const },
        { key: "title", label: "Resource Title", width: 181, align: "left" as const },
        { key: "abbreviation", label: "Abbr.", width: 45, align: "left" as const },
        { key: "issn", label: "ISSN", width: 72, align: "left" as const },
        { key: "subject", label: "Subject Area", width: 91, align: "left" as const },
        { key: "type", label: "Type", width: 62, align: "left" as const },
        { key: "publisher", label: "Publisher", width: 92, align: "left" as const },
        { key: "year", label: "From", width: 34, align: "center" as const },
        { key: "status", label: "Status", width: 43, align: "center" as const },
        { key: "articles", label: "Papers", width: 39, align: "center" as const },
        { key: "citations", label: "Cites", width: 39, align: "center" as const },
      ];
      const tableWidth = pdfColumns.reduce((sum, column) => sum + column.width, 0);
      const drawDocumentHeading = () => {
        document.roundedRect(margin, 24, pageWidth, 58, 7).fill("#073B4C");
        document.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(17)
          .text("International Journal Publishers Association (IJPAss)", margin + 15, 36, { width: pageWidth - 30 });
        document.fillColor("#BCECE7").font("Helvetica").fontSize(9.5)
          .text("Complete Resource Directory", margin + 15, 61, { width: 300 });
        document.fillColor("#FFFFFF").fontSize(8)
          .text(`Generated ${generatedAt.toLocaleString("en-IN")}  |  ${records.length.toLocaleString("en-IN")} resources`, margin + 350, 62, { width: pageWidth - 365, align: "right" });
      };
      const drawTableHeader = (top: number) => {
        let x = margin;
        document.rect(margin, top, tableWidth, 25).fill("#087F76");
        document.font("Helvetica-Bold").fontSize(6.7).fillColor("#FFFFFF");
        for (const column of pdfColumns) {
          document.text(column.label, x + 3, top + 7, { width: column.width - 6, align: column.align, lineBreak: false });
          x += column.width;
        }
        return top + 25;
      };
      drawDocumentHeading();
      let currentY = drawTableHeader(94);
      for (const [index, record] of records.entries()) {
        const rowValues: Record<string, string> = {
          number: String(index + 1), id: String(Number(record.id)), title: record.journalTitle,
          abbreviation: text(record.abbreviation),
          issn: `P: ${text(record.printIssn)}\nO: ${text(record.onlineIssn)}`,
          subject: text(record.subjectArea), type: text(record.sourceType), publisher: text(record.publisher),
          year: text(record.indexedFromYear), status: Number(record.active) === 1 ? "Enabled" : "Disabled",
          articles: Number(record.articleCount).toLocaleString("en-IN"), citations: Number(record.citationCount).toLocaleString("en-IN"),
        };
        document.font("Helvetica").fontSize(6.5);
        const rowHeight = Math.max(22, ...pdfColumns.map((column) =>
          document.heightOfString(rowValues[column.key], { width: column.width - 6, lineGap: 1 }) + 8));
        if (currentY + rowHeight > document.page.height - 40) {
          document.addPage({ size: "A4", layout: "landscape", margin });
          document.fillColor("#073B4C").font("Helvetica-Bold").fontSize(9)
            .text("IJPAss Complete Resource Directory", margin, 22, { width: tableWidth });
          currentY = drawTableHeader(39);
        }
        if (index % 2 === 1) document.rect(margin, currentY, tableWidth, rowHeight).fill("#F3F8F8");
        let x = margin;
        document.font("Helvetica").fontSize(6.5).fillColor("#294B58");
        for (const column of pdfColumns) {
          if (column.key === "title") document.font("Helvetica-Bold");
          else document.font("Helvetica");
          if (column.key === "status") document.fillColor(Number(record.active) === 1 ? "#087F76" : "#B42318");
          else document.fillColor("#294B58");
          document.text(rowValues[column.key], x + 3, currentY + 5, {
            width: column.width - 6, height: rowHeight - 8, align: column.align, lineGap: 1,
          });
          x += column.width;
        }
        document.moveTo(margin, currentY + rowHeight).lineTo(margin + tableWidth, currentY + rowHeight)
          .lineWidth(0.35).strokeColor("#CADADC").stroke();
        currentY += rowHeight;
      }
      const pageRange = document.bufferedPageRange();
      for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
        document.switchToPage(pageIndex);
        document.font("Helvetica").fontSize(7).fillColor("#6B7F87")
          .text(`IJPAss  •  Resource Directory  •  ${dateLabel}`, margin, document.page.height - 24, { width: pageWidth / 2, lineBreak: false })
          .text(`Page ${pageIndex + 1} of ${pageRange.count}`, margin + pageWidth / 2, document.page.height - 24, { width: pageWidth / 2, align: "right", lineBreak: false });
      }
      document.end();
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/sources/options",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const publisherId = z.coerce.number().int().positive().parse(req.query.publisherId);
      const records = await prisma.$queryRaw<Array<{
        id: bigint; journalId: number; journalTitle: string; abbreviation: string | null;
      }>>(Prisma.sql`
      SELECT source.source_data_id id, source.journal_id journalId,
          TRIM(source.journal_title) journalTitle, source.abbreviation
        FROM ijpass_journals.sourcedata_tbl source
        WHERE source.publisher_id=${publisherId}
        ORDER BY source.journal_title ASC
      `);
      return res.json({ resources: records.map((record) => ({ ...record, id: Number(record.id) })) });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/sources/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [source] = await prisma.$queryRaw<Array<{
        id: bigint; journalId: number; journalTitle: string; abbreviation: string | null;
        printIssn: string | null; onlineIssn: string | null; subjectArea: string | null;
        sourceType: string | null; publisherId: number | null; publisher: string | null;
        active: number;
        indexedFromYear: number | null; website: string | null; email: string | null;
        articleCount: bigint;
      }>>(Prisma.sql`SELECT source.source_data_id id,source.journal_id journalId,TRIM(source.journal_title) journalTitle,source.abbreviation,source.print_issn printIssn,source.online_issn onlineIssn,source.subject_area subjectArea,COALESCE(source.source_type,'Journal') sourceType,source.publisher_id publisherId,COALESCE(publisher.publisher_name,source.publisher) publisher,COALESCE(source.active,1) active,source.indexed_from_year indexedFromYear,source.website,source.email,(SELECT COUNT(*) FROM ijpass_journals.manuscript_tbl manuscript WHERE manuscript.journal_id=source.source_data_id) articleCount FROM ijpass_journals.sourcedata_tbl source LEFT JOIN ijpass_journals.publisher_tbl publisher ON publisher.publisher_id=source.publisher_id WHERE source.source_data_id=${id}`);
      if (!source) return res.status(404).json({ message: "Source not found" });
      const [citation] = await prisma.$queryRaw<Array<{ citationCount: bigint }>>(Prisma.sql`SELECT COUNT(*) citationCount FROM ijpass_journals.manuscript_tbl cited_manuscript INNER JOIN ijpass_journals.refdat_table matching_reference ON matching_reference.publication_year=cited_manuscript.publication_year AND REGEXP_REPLACE(LOWER(TRIM(matching_reference.article_title)),'[^[:alnum:]]+','')=REGEXP_REPLACE(LOWER(TRIM(cited_manuscript.article_title)),'[^[:alnum:]]+','') AND matching_reference.manuscript_id<>cited_manuscript.manuscript_id WHERE cited_manuscript.journal_id=${id}`);
      return res.json({
        source: {
          ...source,
          id: Number(source.id),
          active: Number(source.active) === 1,
          articleCount: Number(source.articleCount),
          citationCount: Number(citation?.citationCount || 0),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/sources",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = sourceRecordSchema.parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
        try {
          return await tx.$executeRaw(Prisma.sql`
            INSERT INTO ijpass_journals.sourcedata_tbl (journal_id, journal_title, abbreviation, print_issn, online_issn, subject_area, source_type, publisher_id, publisher, indexed_from_year, website, email, active)
            SELECT ${input.journalId}, ${input.journalTitle}, ${input.abbreviation || null}, ${input.printIssn || null}, ${input.onlineIssn || null}, ${input.subjectArea || null}, ${input.sourceType}, publisher_id, publisher_name, ${input.indexedFromYear || null}, ${input.website || null}, ${input.email || null}, ${input.active ? 1 : 0}
            FROM ijpass_journals.publisher_tbl WHERE publisher_id=${input.publisherId}
          `);
        } finally {
          await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
        }
      });
      return res
        .status(201)
        .json({ message: "Source added successfully", affectedRows: result });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/sources/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = sourceRecordSchema.parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
        try {
          return await tx.$executeRaw(Prisma.sql`
            UPDATE ijpass_journals.sourcedata_tbl SET journal_id = ${input.journalId}, journal_title = ${input.journalTitle},
              abbreviation = ${input.abbreviation || null}, print_issn = ${input.printIssn || null}, online_issn = ${input.onlineIssn || null},
              subject_area = ${input.subjectArea || null}, source_type = ${input.sourceType},
              publisher_id = ${input.publisherId}, publisher = (SELECT publisher_name FROM ijpass_journals.publisher_tbl WHERE publisher_id=${input.publisherId}), indexed_from_year = ${input.indexedFromYear || null},
              website = ${input.website || null}, email = ${input.email || null}, active = ${input.active ? 1 : 0}
            WHERE source_data_id = ${id}
          `);
        } finally {
          await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
        }
      });
      if (!result) return res.status(404).json({ message: "Source not found" });
      return res.json({ message: "Source updated successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/sources/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [{ articleCount }] = await prisma.$queryRaw<
        Array<{ articleCount: bigint }>
      >(
        Prisma.sql`SELECT COUNT(*) AS articleCount FROM ijpass_journals.manuscript_tbl WHERE journal_id = ${id}`,
      );
      if (Number(articleCount))
        return res
          .status(409)
          .json({
            message:
              "This source cannot be deleted while indexed articles are linked to it.",
          });
      const result = await prisma.$executeRaw(
        Prisma.sql`DELETE FROM ijpass_journals.sourcedata_tbl WHERE source_data_id = ${id}`,
      );
      if (!result) return res.status(404).json({ message: "Source not found" });
      return res.json({ message: "Source deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/manuscripts",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          q: z.string().trim().max(150).catch(""),
          page: z.coerce.number().int().positive().catch(1),
          sort: z
            .enum(["newest", "title", "source", "subject", "year", "references"])
            .catch("newest"),
        })
        .parse(req.query);
      const pageSize = 20;
      const search = input.q
        ? Prisma.sql`WHERE manuscript.article_code LIKE ${`%${input.q}%`} OR manuscript.article_title LIKE ${`%${input.q}%`} OR source.journal_title LIKE ${`%${input.q}%`} OR subject.subject_area LIKE ${`%${input.q}%`} OR subject.classification_name LIKE ${`%${input.q}%`} OR subject.major_subject LIKE ${`%${input.q}%`} OR manuscript.doi LIKE ${`%${input.q}%`} OR CAST(manuscript.manuscript_id AS CHAR) LIKE ${`%${input.q}%`} OR CAST(manuscript.publication_year AS CHAR) LIKE ${`%${input.q}%`} OR EXISTS (SELECT 1 FROM ijpass_journals.manuscript_author_tbl search_link INNER JOIN ijpass_journals.authordata_tbl search_author ON search_author.author_data_id=search_link.author_data_id WHERE search_link.manuscript_id=manuscript.manuscript_id AND search_author.author_name LIKE ${`%${input.q}%`})`
        : Prisma.empty;
      const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) total FROM ijpass_journals.manuscript_tbl manuscript INNER JOIN ijpass_journals.sourcedata_tbl source ON source.source_data_id=manuscript.journal_id LEFT JOIN ijpass_journals.subject_area_tbl subject ON subject.subject_area_id=manuscript.subject_area_id ${search}`,
      );
      const totalRecords = Number(total),
        totalPages = Math.max(1, Math.ceil(totalRecords / pageSize)),
        page = Math.min(input.page, totalPages),
        offset = (page - 1) * pageSize;
      const order =
        input.sort === "title"
          ? Prisma.sql`manuscript.article_title ASC`
          : input.sort === "source"
            ? Prisma.sql`source.journal_title ASC, manuscript.manuscript_id DESC`
            : input.sort === "subject"
              ? Prisma.sql`subject.subject_area ASC, manuscript.manuscript_id DESC`
            : input.sort === "year"
              ? Prisma.sql`manuscript.publication_year DESC, manuscript.manuscript_id DESC`
              : input.sort === "references"
                ? Prisma.sql`referenceCount DESC, manuscript.manuscript_id DESC`
                : Prisma.sql`manuscript.manuscript_id DESC`;
      const records = await prisma.$queryRaw<
        Array<{
          id: bigint;
          articleCode: string;
          articleTitle: string;
          journalId: bigint;
          journalTitle: string;
          subjectAreaId: bigint | null;
          subjectArea: string | null;
          subjectClassification: string | null;
          authors: string | null;
          volume: string | null;
          issue: string | null;
          pages: string | null;
          publicationYear: number | null;
          doi: string | null;
          referenceCount: bigint;
        }>
      >(Prisma.sql`
      SELECT manuscript.manuscript_id id, manuscript.article_code articleCode, TRIM(manuscript.article_title) articleTitle, manuscript.journal_id journalId, TRIM(source.journal_title) journalTitle, manuscript.subject_area_id subjectAreaId,subject.subject_area subjectArea,subject.classification_name subjectClassification,manuscript.volume, manuscript.issue, manuscript.pages, manuscript.publication_year publicationYear, manuscript.doi,
        (SELECT GROUP_CONCAT(author.author_name ORDER BY link.author_order SEPARATOR ', ') FROM ijpass_journals.manuscript_author_tbl link INNER JOIN ijpass_journals.authordata_tbl author ON author.author_data_id=link.author_data_id WHERE link.manuscript_id=manuscript.manuscript_id) authors,
        (SELECT COUNT(*) FROM ijpass_journals.refdat_table reference WHERE reference.manuscript_id=manuscript.manuscript_id) referenceCount
      FROM ijpass_journals.manuscript_tbl manuscript INNER JOIN ijpass_journals.sourcedata_tbl source ON source.source_data_id=manuscript.journal_id LEFT JOIN ijpass_journals.subject_area_tbl subject ON subject.subject_area_id=manuscript.subject_area_id ${search} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}
    `);
      return res.json({
        manuscripts: records.map((record) => ({
          ...record,
          id: Number(record.id),
          journalId: Number(record.journalId),
          subjectAreaId: record.subjectAreaId ? Number(record.subjectAreaId) : null,
          referenceCount: Number(record.referenceCount),
        })),
        pagination: { page, pageSize, totalRecords, totalPages },
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/manuscript-sources",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req, res, next) => {
    try {
      const records = await prisma.$queryRaw<
        Array<{ id: bigint; title: string }>
      >(
        Prisma.sql`SELECT source_data_id id, TRIM(journal_title) title FROM ijpass_journals.sourcedata_tbl ORDER BY TRIM(journal_title)`,
      );
      return res.json({
        sources: records.map((record) => ({
          id: Number(record.id),
          title: record.title,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/manuscript-subject-areas",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req, res, next) => {
    try {
      const records = await prisma.$queryRaw<Array<{
        id: bigint;
        majorSubject: string;
        classificationName: string;
        subjectArea: string;
      }>>(Prisma.sql`
        SELECT subject_area_id id,major_subject majorSubject,
          classification_name classificationName,subject_area subjectArea
        FROM ijpass_journals.subject_area_tbl
        ORDER BY major_subject,classification_name,subject_area`);
      return res.json({
        subjectAreas: records.map((record) => ({ ...record, id: Number(record.id) })),
      });
    } catch (error) { next(error); }
  },
);

app.get(
  "/api/admin/manuscripts/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const [record] = await prisma.$queryRaw<
        Array<{
          id: bigint;
          articleCode: string;
          articleTitle: string;
          journalId: bigint;
          subjectAreaId: bigint | null;
          authorId: bigint;
          primaryAuthorProfileId: bigint | null;
          volume: string | null;
          issue: string | null;
          pages: string | null;
          publicationMonth: string | null;
          publicationYear: number | null;
          doi: string | null;
          articleLink: string | null;
          abstract: string | null;
          keywords: string | null;
        }>
      >(
        Prisma.sql`SELECT manuscript_id id, article_code articleCode, article_title articleTitle, journal_id journalId, subject_area_id subjectAreaId, author_id authorId, primary_author_profile_id primaryAuthorProfileId, volume, issue, pages, publication_month publicationMonth, publication_year publicationYear, doi, article_link articleLink, abstract, keywords FROM ijpass_journals.manuscript_tbl WHERE manuscript_id=${id} LIMIT 1`,
      );
      if (!record)
        return res.status(404).json({ message: "Manuscript not found" });
      const authorAssignments = await prisma.$queryRaw<Array<{
        authorProfileId: bigint;
        affiliationId: bigint | null;
        authorDataId: bigint;
        authorOrder: number;
        salutation: string | null;
        name: string;
        affiliation: string | null;
        country: string | null;
        designation: string | null;
      }>>(Prisma.sql`
        SELECT authorship.author_profile_id authorProfileId,authorship.author_data_id authorDataId,
          authorship.author_order authorOrder,profile.salutation,profile.author_name name,
          source_author.university_company affiliation,source_author.country,
          source_author.department_designation designation,
          (SELECT link.affiliation_id
            FROM ijpass_journals.author_affiliation_tbl link
            INNER JOIN ijpass_journals.affiliationdata_tbl linked_affiliation
              ON linked_affiliation.affiliation_id=link.affiliation_id
            WHERE link.author_profile_id=authorship.author_profile_id
            ORDER BY CASE WHEN
              REGEXP_REPLACE(LOWER(TRIM(LEADING ', ' FROM linked_affiliation.university_company)), '[^[:alnum:]]+', '') =
              REGEXP_REPLACE(LOWER(TRIM(LEADING ', ' FROM COALESCE(source_author.university_company,''))), '[^[:alnum:]]+', '')
              THEN 0 ELSE 1 END,link.affiliation_id
            LIMIT 1) affiliationId
        FROM ijpass_journals.manuscript_author_tbl authorship
        INNER JOIN ijpass_journals.author_profile_tbl profile
          ON profile.author_profile_id=authorship.author_profile_id
        INNER JOIN ijpass_journals.authordata_tbl source_author
          ON source_author.author_data_id=authorship.author_data_id
        WHERE authorship.manuscript_id=${id}
        ORDER BY authorship.author_order`);
      return res.json({
        manuscript: {
          ...record,
          id: Number(record.id),
          journalId: Number(record.journalId),
          subjectAreaId: record.subjectAreaId ? Number(record.subjectAreaId) : null,
          authorId: Number(record.authorId),
          primaryAuthorProfileId: record.primaryAuthorProfileId
            ? Number(record.primaryAuthorProfileId)
            : null,
          authorAssignments: authorAssignments.map((author) => ({
            ...author,
            authorProfileId: Number(author.authorProfileId),
            affiliationId: author.affiliationId ? Number(author.affiliationId) : null,
            authorDataId: Number(author.authorDataId),
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

type ResolvedManuscriptAuthor = {
  authorProfileId: number;
  affiliationId: number;
  sourceAuthorId: number;
  authorName: string;
  email: string | null;
  affiliation: string;
  country: string | null;
  designation: string | null;
};
const resolveManuscriptAuthors = async (
  tx: Prisma.TransactionClient,
  assignments: Array<z.infer<typeof manuscriptAuthorAssignmentSchema>>,
): Promise<ResolvedManuscriptAuthor[]> => {
  if (!assignments.length) return [];
  const profileIds = assignments.map((author) => author.authorProfileId),
    affiliationIds = assignments.map((author) => author.affiliationId);
  const profiles = await tx.$queryRaw<Array<{
    id: bigint;
    sourceAuthorId: number;
    salutation: string | null;
    name: string;
    email: string | null;
  }>>(Prisma.sql`
    SELECT author_profile_id id,source_author_id sourceAuthorId,salutation,author_name name,email
    FROM ijpass_journals.author_profile_tbl
    WHERE author_profile_id IN (${Prisma.join(profileIds)})`);
  const affiliations = await tx.$queryRaw<Array<{
    authorProfileId: bigint;
    affiliationId: bigint;
    name: string;
    country: string | null;
  }>>(Prisma.sql`
    SELECT link.author_profile_id authorProfileId,affiliation.affiliation_id affiliationId,
      TRIM(LEADING ', ' FROM TRIM(affiliation.university_company)) name,affiliation.country
    FROM ijpass_journals.author_affiliation_tbl link
    INNER JOIN ijpass_journals.affiliationdata_tbl affiliation
      ON affiliation.affiliation_id=link.affiliation_id
    WHERE link.author_profile_id IN (${Prisma.join(profileIds)})
      AND link.affiliation_id IN (${Prisma.join(affiliationIds)})`);
  return assignments.map((assignment) => {
    const profile = profiles.find((item) => Number(item.id) === assignment.authorProfileId),
      affiliation = affiliations.find((item) => Number(item.authorProfileId) === assignment.authorProfileId && Number(item.affiliationId) === assignment.affiliationId);
    if (!profile) throw Object.assign(new Error(`Author ID ${assignment.authorProfileId} was not found`), { statusCode: 400 });
    if (!affiliation) throw Object.assign(new Error(`Affiliation ID ${assignment.affiliationId} is not linked to Author ID ${assignment.authorProfileId}`), { statusCode: 400 });
    return {
      authorProfileId: assignment.authorProfileId,
      affiliationId: assignment.affiliationId,
      sourceAuthorId: profile.sourceAuthorId,
      authorName: [profile.salutation, profile.name].filter(Boolean).join(" "),
      email: profile.email,
      affiliation: affiliation.name,
      country: affiliation.country?.trim().replace(/[.,]+$/, "") || null,
      designation: assignment.designation || null,
    };
  });
};

const insertManuscriptAuthorData = async (
  tx: Prisma.TransactionClient,
  articleCode: string,
  authors: ResolvedManuscriptAuthor[],
) => {
  const rows: Array<ResolvedManuscriptAuthor & { authorDataId: number; authorOrder: number }> = [];
  for (const [index, author] of authors.entries()) {
    const authorOrder = index + 1;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO ijpass_journals.authordata_tbl
        (article_code,source_author_id,author_order,author_name,department_designation,university_company,country,email)
      VALUES (${articleCode},${author.sourceAuthorId},${authorOrder},${author.authorName},
        ${author.designation},${author.affiliation || null},${author.country},${author.email})`);
    const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`SELECT LAST_INSERT_ID() id`);
    rows.push({ ...author, authorDataId: Number(id), authorOrder });
  }
  return rows;
};

app.post(
  "/api/admin/manuscripts",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = manuscriptRecordSchema.parse(req.body);
      const manuscriptId = await prisma.$transaction(async (tx) => {
        if (input.authors.length) {
          const resolvedAuthors = await resolveManuscriptAuthors(tx, input.authors),
            authorRows = await insertManuscriptAuthorData(tx, input.articleCode, resolvedAuthors),
            primary = authorRows[0];
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO ijpass_journals.manuscript_tbl (article_code, article_title, journal_id, subject_area_id, author_id, primary_author_profile_id, volume, issue, pages, publication_month, publication_year, doi, article_link, abstract, keywords)
            VALUES (${input.articleCode}, ${input.articleTitle}, ${input.journalId}, ${input.subjectAreaId}, ${primary.authorDataId}, ${primary.authorProfileId}, ${input.volume || null}, ${input.issue || null}, ${input.pages || null}, ${input.publicationMonth || null}, ${input.publicationYear || null}, ${input.doi || null}, ${input.articleLink || null}, ${input.abstract || null}, ${input.keywords || null})`);
          const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`SELECT LAST_INSERT_ID() id`);
          for (const author of authorRows)
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO ijpass_journals.manuscript_author_tbl(manuscript_id,author_profile_id,author_data_id,author_order)
              VALUES(${id},${author.authorProfileId},${author.authorDataId},${author.authorOrder})`);
          return Number(id);
        }
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO ijpass_journals.manuscript_tbl (article_code, article_title, journal_id, subject_area_id, author_id, primary_author_profile_id, volume, issue, pages, publication_month, publication_year, doi, article_link, abstract, keywords)
          VALUES (${input.articleCode}, ${input.articleTitle}, ${input.journalId}, ${input.subjectAreaId}, ${Number(input.authorId)}, ${input.primaryAuthorProfileId || null}, ${input.volume || null}, ${input.issue || null}, ${input.pages || null}, ${input.publicationMonth || null}, ${input.publicationYear || null}, ${input.doi || null}, ${input.articleLink || null}, ${input.abstract || null}, ${input.keywords || null})`);
        const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`SELECT LAST_INSERT_ID() id`);
        return Number(id);
      });
      return res.status(201).json({ message: "Manuscript added successfully", id: manuscriptId });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/manuscripts/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = manuscriptRecordSchema.parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        if (input.authors.length) {
          const existingRows = await tx.$queryRaw<Array<{ authorDataId: bigint }>>(
            Prisma.sql`SELECT author_data_id authorDataId FROM ijpass_journals.manuscript_author_tbl WHERE manuscript_id=${id}`,
          );
          const resolvedAuthors = await resolveManuscriptAuthors(tx, input.authors);
          if (existingRows.length)
            await tx.$executeRaw(Prisma.sql`
              UPDATE ijpass_journals.authordata_tbl
              SET article_code=CONCAT('__OLD_',${id},'_',author_data_id),author_order=author_order+1000
              WHERE author_data_id IN (${Prisma.join(existingRows.map((row) => Number(row.authorDataId)))})`);
          const authorRows = await insertManuscriptAuthorData(tx, input.articleCode, resolvedAuthors),
            primary = authorRows[0];
          const updated = await tx.$executeRaw(Prisma.sql`
            UPDATE ijpass_journals.manuscript_tbl SET article_code=${input.articleCode}, article_title=${input.articleTitle}, journal_id=${input.journalId}, subject_area_id=${input.subjectAreaId}, author_id=${primary.authorDataId}, primary_author_profile_id=${primary.authorProfileId}, volume=${input.volume || null}, issue=${input.issue || null}, pages=${input.pages || null}, publication_month=${input.publicationMonth || null}, publication_year=${input.publicationYear || null}, doi=${input.doi || null}, article_link=${input.articleLink || null}, abstract=${input.abstract || null}, keywords=${input.keywords || null}
            WHERE manuscript_id=${id}`);
          if (!updated) return 0;
          await tx.$executeRaw(Prisma.sql`DELETE FROM ijpass_journals.manuscript_author_tbl WHERE manuscript_id=${id}`);
          for (const author of authorRows)
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO ijpass_journals.manuscript_author_tbl(manuscript_id,author_profile_id,author_data_id,author_order)
              VALUES(${id},${author.authorProfileId},${author.authorDataId},${author.authorOrder})`);
          if (existingRows.length)
            await tx.$executeRaw(Prisma.sql`
              DELETE FROM ijpass_journals.authordata_tbl
              WHERE author_data_id IN (${Prisma.join(existingRows.map((row) => Number(row.authorDataId)))})`);
          return updated;
        }
        return tx.$executeRaw(Prisma.sql`
          UPDATE ijpass_journals.manuscript_tbl SET article_code=${input.articleCode}, article_title=${input.articleTitle}, journal_id=${input.journalId}, subject_area_id=${input.subjectAreaId}, author_id=${Number(input.authorId)}, primary_author_profile_id=${input.primaryAuthorProfileId || null}, volume=${input.volume || null}, issue=${input.issue || null}, pages=${input.pages || null}, publication_month=${input.publicationMonth || null}, publication_year=${input.publicationYear || null}, doi=${input.doi || null}, article_link=${input.articleLink || null}, abstract=${input.abstract || null}, keywords=${input.keywords || null}
          WHERE manuscript_id=${id}`);
      });
      if (!result)
        return res.status(404).json({ message: "Manuscript not found" });
      return res.json({ message: "Manuscript updated successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/manuscripts/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const result = await prisma.$executeRaw(
        Prisma.sql`DELETE FROM ijpass_journals.manuscript_tbl WHERE manuscript_id=${id}`,
      );
      if (!result)
        return res.status(404).json({ message: "Manuscript not found" });
      return res.json({
        message:
          "Manuscript and its linked authorship/reference rows deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/membership-categories", async (_req, res, next) => {
  try {
    const categories = await prisma.membershipCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return res.json({ categories });
  } catch (error) {
    next(error);
  }
});

app.get("/api/members/suggestions", async (req, res, next) => {
  try {
    const { q } = z.object({ q: z.string().trim().min(2).max(150) }).parse(req.query);
    const indexedIds = await searchMemberIds(q);
    const rows = await prisma.member.findMany({
      where: {
        active: true,
        OR: [
          ...(indexedIds?.length ? [{ id: { in: indexedIds.map(Number) } }] : []),
          { fullName: { contains: q } },
          { affiliation: { contains: q } },
          { country: { contains: q } },
          { fieldOfExpertise: { contains: q } },
        ],
      },
      select: { fullName: true },
      orderBy: { fullName: "asc" },
      take: 8,
    });
    return res.json({ suggestions: rows.map((member) => member.fullName) });
  } catch (error) { next(error); }
});

app.get("/api/members", async (req, res, next) => {
  try {
    await disableExpiredMembers();
    const query = String(req.query.q || "").trim();
    const elasticIds = query ? await searchMemberIds(query) : null;
    const [categories, memberRecords] = await Promise.all([
      prisma.membershipCategory.findMany({
        where: { active: true },
        select: { id: true, name: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      prisma.member.findMany({
        where: {
          active: true,
          ...(query
            ? {
                OR: [
                  ...(elasticIds?.length ? [{ id: { in: elasticIds.map(Number) } }] : []),
                  { fullName: { contains: query } },
                  { affiliation: { contains: query } },
                  { country: { contains: query } },
                  { fieldOfExpertise: { contains: query } },
                ],
              }
            : {}),
        },
        include: { membershipCategory: { select: { name: true } } },
        orderBy: { fullName: "asc" },
      }),
    ]);
    const members = memberRecords.map((member) => ({
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
      orcid: member.orcid,
    }));
    return res.json({ categories, members });
  } catch (error) {
    next(error);
  }
});

app.get("/api/members/:memberName", async (req, res, next) => {
  try {
    await disableExpiredMembers();
    const fullName = z
      .string()
      .trim()
      .min(2)
      .max(150)
      .parse(req.params.memberName.replace(/_/g, " "));
    const member = await prisma.member.findFirst({
      where: { fullName, active: true },
      include: { membershipCategory: { select: { name: true, active: true } } },
    });
    if (!member || !member.membershipCategory.active)
      return res.status(404).json({ message: "Member profile not found" });
    return res.json({
      member: {
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
        orcid: member.orcid,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/members",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req, res, next) => {
    try {
      await disableExpiredMembers();
      const members = await prisma.member.findMany({
        include: { membershipCategory: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return res.json({ members });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/members",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  memberPhotoUpload.single("photo"),
  async (req, res, next) => {
    try {
      const input = memberSchema.parse(req.body);
      const category = await prisma.membershipCategory.findFirst({
        where: { id: input.membershipCategoryId, active: true },
      });
      if (!category)
        return res
          .status(400)
          .json({ message: "Select a valid membership category" });
      const existingName = await prisma.member.findFirst({
        where: { fullName: input.fullName },
      });
      if (existingName)
        return res
          .status(409)
          .json({
            message:
              "A member with this full name already exists. Member names must be unique for public profile URLs.",
          });
      const membershipUntil = membershipExpiry(
        input.membershipFrom,
        category.validity,
      );
      const active =
        input.active && (!membershipUntil || membershipUntil > new Date());
      const member = await prisma.$transaction(async (transaction) => {
        const created = await transaction.member.create({
          data: {
            ...input,
            active,
            membershipUntil,
            affiliation: input.affiliation || null,
            country: input.country || null,
            shortProfile: input.shortProfile || null,
            fieldOfExpertise: input.fieldOfExpertise || null,
            googleScholarUrl: input.googleScholarUrl || null,
            researchGateUrl: input.researchGateUrl || null,
            orcid: input.orcid || null,
            photo: req.file ? `/uploads/members/${req.file.filename}` : null,
          },
        });
        return transaction.member.update({
          where: { id: created.id },
          data: {
            membershipId: createMembershipId(
              category.name,
              input.membershipFrom,
              created.id,
            ),
          },
          include: { membershipCategory: { select: { id: true, name: true } } },
        });
      });
      queueMemberNotification(member, "created");
      return res
        .status(201)
        .json({ message: "Member created successfully", member });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/members/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  memberPhotoUpload.single("photo"),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = memberSchema.parse(req.body);
      const [current, category, existingName] = await Promise.all([
        prisma.member.findUnique({ where: { id } }),
        prisma.membershipCategory.findUnique({
          where: { id: input.membershipCategoryId },
        }),
        prisma.member.findFirst({
          where: { fullName: input.fullName, NOT: { id } },
        }),
      ]);
      if (!current)
        return res.status(404).json({ message: "Member record not found" });
      if (!category)
        return res
          .status(400)
          .json({ message: "Select a valid membership category" });
      if (existingName)
        return res
          .status(409)
          .json({
            message:
              "A member with this full name already exists. Member names must be unique for public profile URLs.",
          });
      const membershipUntil = membershipExpiry(
        input.membershipFrom,
        category.validity,
      );
      const active =
        input.active && (!membershipUntil || membershipUntil > new Date());
      const member = await prisma.member.update({
        where: { id },
        data: {
          ...input,
          active,
          membershipId: createMembershipId(
            category.name,
            input.membershipFrom,
            id,
          ),
          membershipUntil,
          affiliation: input.affiliation || null,
          country: input.country || null,
          shortProfile: input.shortProfile || null,
          fieldOfExpertise: input.fieldOfExpertise || null,
          googleScholarUrl: input.googleScholarUrl || null,
          researchGateUrl: input.researchGateUrl || null,
          orcid: input.orcid || null,
          photo: req.file
            ? `/uploads/members/${req.file.filename}`
            : current.photo,
        },
        include: { membershipCategory: { select: { id: true, name: true } } },
      });
      if (req.file && current.photo) await removeMemberPhoto(current.photo);
      queueMemberNotification(
        member,
        current.active === member.active
          ? "updated"
          : member.active
            ? "enabled"
            : "disabled",
      );
      return res.json({ message: "Member updated successfully", member });
    } catch (error) {
      next(error);
    }
  },
);

app.patch(
  "/api/admin/members/:id/status",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { active } = z.object({ active: z.boolean() }).parse(req.body);
      const member = await prisma.member.update({
        where: { id },
        data: { active },
        include: { membershipCategory: { select: { name: true } } },
      });
      queueMemberNotification(member, active ? "enabled" : "disabled");
      return res.json({
        message: `Member ${active ? "enabled" : "disabled"} successfully`,
        member,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/members/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const member = await prisma.member.findUnique({
        where: { id },
        include: { membershipCategory: { select: { name: true } } },
      });
      if (!member)
        return res.status(404).json({ message: "Member record not found" });
      await prisma.member.delete({ where: { id } });
      await removeMemberPhoto(member.photo);
      queueMemberNotification(member, "deleted");
      return res.json({ message: "Member deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/membership-categories",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req, res, next) => {
    try {
      const categories = await prisma.membershipCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      return res.json({ categories });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/membership-categories",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = membershipCategorySchema.parse(req.body);
      const last = await prisma.membershipCategory.aggregate({
        _max: { sortOrder: true },
      });
      const category = await prisma.membershipCategory.create({
        data: { ...input, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
      return res
        .status(201)
        .json({
          message: "Membership category created successfully",
          category,
        });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/membership-categories/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = membershipCategorySchema.parse(req.body);
      const category = await prisma.membershipCategory.update({
        where: { id },
        data: input,
      });
      return res.json({
        message: "Membership category updated successfully",
        category,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/membership-categories/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      await prisma.membershipCategory.delete({ where: { id } });
      return res.json({ message: "Membership category deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/internal-users",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = internalUserSchema.parse(req.body);
      const exists = await prisma.user.findUnique({
        where: { email: input.email },
      });
      if (exists)
        return res
          .status(409)
          .json({
            message: "An account already exists with this email address",
          });
      const password = await bcrypt.hash(input.password, 12);
      const user = await prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          password,
          organization: input.organization || "IJPAss",
          role: UserRole.INTERNAL_USER,
          active: input.active,
          permissions: input.permissions,
        },
        select: {
          id: true,
          name: true,
          email: true,
          organization: true,
          role: true,
          active: true,
          permissions: true,
          createdAt: true,
        },
      });
      return res
        .status(201)
        .json({ message: "Internal User created successfully", user });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/internal-users/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = accountUpdateSchema.parse(req.body);
      const existing = await prisma.user.findFirst({
        where: { id, role: UserRole.INTERNAL_USER },
      });
      if (!existing)
        return res.status(404).json({ message: "Internal User not found" });
      const duplicate = await prisma.user.findFirst({
        where: { email: input.email, NOT: { id } },
      });
      if (duplicate)
        return res
          .status(409)
          .json({
            message: "An account already exists with this email address",
          });
      const { password, ...details } = input;
      const user = await prisma.user.update({
        where: { id },
        data: {
          ...details,
          ...(password ? { password: await bcrypt.hash(password, 12) } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          organization: true,
          active: true,
          permissions: true,
          createdAt: true,
        },
      });
      return res.json({ message: "Internal User updated successfully", user });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/internal-users/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const existing = await prisma.user.findFirst({
        where: { id, role: UserRole.INTERNAL_USER },
      });
      if (!existing)
        return res.status(404).json({ message: "Internal User not found" });
      await prisma.user.delete({ where: { id } });
      return res.json({ message: "Internal User deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/publishers",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req, res, next) => {
    try {
      const publishers = await prisma.user.findMany({
        where: { role: UserRole.PUBLISHER },
        select: {
          id: true,
          name: true,
          email: true,
          organization: true,
          country: true,
          website: true,
          active: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json({ publishers });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/publishers",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const input = publisherSchema.parse(req.body);
      const exists = await prisma.user.findUnique({
        where: { email: input.email },
      });
      if (exists)
        return res
          .status(409)
          .json({
            message: "An account already exists with this email address",
          });
      const password = await bcrypt.hash(input.password, 12);
      const publisher = await prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          password,
          organization: input.organization,
          country: input.country || null,
          website: input.website || null,
          role: UserRole.PUBLISHER,
          active: input.active,
        },
        select: {
          id: true,
          name: true,
          email: true,
          organization: true,
          country: true,
          website: true,
          active: true,
          createdAt: true,
        },
      });
      return res
        .status(201)
        .json({ message: "Publisher account created successfully", publisher });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/publishers/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = publisherUpdateSchema.parse(req.body);
      const existing = await prisma.user.findFirst({
        where: { id, role: UserRole.PUBLISHER },
      });
      if (!existing)
        return res.status(404).json({ message: "Publisher account not found" });
      const duplicate = await prisma.user.findFirst({
        where: { email: input.email, NOT: { id } },
      });
      if (duplicate)
        return res
          .status(409)
          .json({
            message: "An account already exists with this email address",
          });
      const { password, ...details } = input;
      const publisher = await prisma.user.update({
        where: { id },
        data: {
          ...details,
          country: details.country || null,
          website: details.website || null,
          ...(password ? { password: await bcrypt.hash(password, 12) } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          organization: true,
          country: true,
          website: true,
          active: true,
          createdAt: true,
        },
      });
      return res.json({
        message: "Publisher account updated successfully",
        publisher,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/publishers/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const existing = await prisma.user.findFirst({
        where: { id, role: UserRole.PUBLISHER },
      });
      if (!existing)
        return res.status(404).json({ message: "Publisher account not found" });
      await prisma.user.delete({ where: { id } });
      return res.json({ message: "Publisher account deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/contact-enquiries",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN, UserRole.INTERNAL_USER),
  async (req, res, next) => {
    try {
      const query = String(req.query.q || "").trim();
      const enquiries = await prisma.contactMessage.findMany({
        where: query
          ? {
              OR: [
                { name: { contains: query } },
                { email: { contains: query } },
                { organization: { contains: query } },
                { country: { contains: query } },
              ],
            }
          : {},
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      res.json({ enquiries });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/contact-enquiries/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const existing = await prisma.contactMessage.findUnique({
        where: { id },
      });
      if (!existing)
        return res.status(404).json({ message: "Contact enquiry not found" });
      await prisma.contactMessage.delete({ where: { id } });
      return res.json({ message: "Contact enquiry deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/membership-applications",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN, UserRole.INTERNAL_USER),
  async (req, res, next) => {
    try {
      const query = String(req.query.q || "")
        .trim()
        .toLocaleLowerCase();
      const applications = await prisma.application.findMany({
        where: { type: ApplicationType.MEMBERSHIP },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      const records = applications
        .map((application) => {
          const data = membershipApplicationData(application.data);
          return {
            id: application.id,
            reference: application.reference,
            status: application.status,
            createdAt: application.createdAt,
            name: data.name,
            email: data.email,
            phone: data.phone,
            affiliation: data.affiliation,
            country: data.country,
            membershipCategory: data.membershipCategory,
            message: data.message,
            photo: data.photo
              ? { originalName: data.photo.originalName, size: data.photo.size }
              : null,
            resume: data.resume
              ? {
                  originalName: data.resume.originalName,
                  size: data.resume.size,
                }
              : null,
          };
        })
        .filter(
          (application) =>
            !query ||
            [
              application.reference,
              application.name,
              application.email,
              application.phone,
              application.affiliation,
              application.country,
              application.membershipCategory,
              application.message,
            ].some((value) =>
              String(value || "")
                .toLocaleLowerCase()
                .includes(query),
            ),
        );
      return res.json({ applications: records });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/membership-applications/:id/files/:kind",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN, UserRole.INTERNAL_USER),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const kind = z.enum(["photo", "resume"]).parse(req.params.kind);
      const application = await prisma.application.findFirst({
        where: { id, type: ApplicationType.MEMBERSHIP },
      });
      if (!application)
        return res
          .status(404)
          .json({ message: "Membership application not found" });
      const file = membershipApplicationData(application.data)[kind];
      if (!file?.storedName)
        return res
          .status(404)
          .json({
            message: `${kind === "photo" ? "Photo" : "Resume"} file not found`,
          });
      return res.download(
        membershipApplicationFilePath(file.storedName),
        file.originalName,
      );
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/admin/membership-applications/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const application = await prisma.application.findFirst({
        where: { id, type: ApplicationType.MEMBERSHIP },
      });
      if (!application)
        return res
          .status(404)
          .json({ message: "Membership application not found" });
      const data = membershipApplicationData(application.data);
      const files = [data.photo?.storedName, data.resume?.storedName].filter(
        (name): name is string => Boolean(name),
      );
      await Promise.all(
        files.map((name) =>
          unlink(membershipApplicationFilePath(name)).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            },
          ),
        ),
      );
      await prisma.application.delete({ where: { id } });
      return res.json({
        message: "Membership application deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/contact", async (req, res, next) => {
  try {
    const input = contactSchema.parse(req.body);
    const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
    if (!secret) {
      console.error("RECAPTCHA_SECRET_KEY is not configured");
      return res
        .status(503)
        .json({
          message: "Contact form verification is temporarily unavailable.",
        });
    }
    const verificationBody = new URLSearchParams({
      secret,
      response: input.recaptchaToken,
    });
    const verificationResponse = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verificationBody,
      },
    );
    if (!verificationResponse.ok)
      throw new Error(
        `reCAPTCHA verification returned HTTP ${verificationResponse.status}`,
      );
    const verification = z
      .object({
        success: z.boolean(),
        hostname: z.string().optional(),
        "error-codes": z.array(z.string()).optional(),
      })
      .parse(await verificationResponse.json());
    if (!verification.success)
      return res
        .status(400)
        .json({
          message:
            "reCAPTCHA verification failed or expired. Please try again.",
        });

    const { recaptchaToken: _recaptchaToken, ...contact } = input;
    const saved = await prisma.contactMessage.create({ data: contact });
    void sendContactEmails(contact, saved.id)
      .then((result) => {
        if (!result.sent) console.warn(`Contact ${saved.id}: ${result.reason}`);
      })
      .catch((mailError) =>
        console.error(`Contact ${saved.id}: email delivery failed`, mailError),
      );
    return res
      .status(201)
      .json({
        message: "Enquiry received",
        id: saved.id,
        reference: `ENQ-${String(saved.id).padStart(6, "0")}`,
        emailQueued: true,
      });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/membership-applications",
  membershipApplicationUpload.fields([
    { name: "photo", maxCount: 1 },
    { name: "resume", maxCount: 1 },
  ]),
  async (req, res, next) => {
    const files = req.files as
      | { photo?: Express.Multer.File[]; resume?: Express.Multer.File[] }
      | undefined;
    const uploadedFiles = [...(files?.photo || []), ...(files?.resume || [])];
    const removeUploads = async () =>
      Promise.all(
        uploadedFiles.map((file) =>
          unlink(file.path).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          }),
        ),
      );
    try {
      const input = membershipApplicationSchema.parse(req.body);
      const photo = files?.photo?.[0];
      const resume = files?.resume?.[0];
      if (!photo || !resume) {
        await removeUploads();
        return res
          .status(400)
          .json({ message: "A photo and Resume file are required." });
      }
      const category = await prisma.membershipCategory.findFirst({
        where: { id: input.membershipCategoryId, active: true },
        select: { id: true, name: true },
      });
      if (!category) {
        await removeUploads();
        return res
          .status(400)
          .json({ message: "Select a valid membership category." });
      }
      const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
      if (!secret) {
        await removeUploads();
        console.error("RECAPTCHA_SECRET_KEY is not configured");
        return res
          .status(503)
          .json({
            message: "Membership form verification is temporarily unavailable.",
          });
      }
      const verificationResponse = await fetch(
        "https://www.google.com/recaptcha/api/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret, response: input.recaptchaToken }),
        },
      );
      if (!verificationResponse.ok)
        throw new Error(
          `reCAPTCHA verification returned HTTP ${verificationResponse.status}`,
        );
      const verification = z
        .object({ success: z.boolean() })
        .passthrough()
        .parse(await verificationResponse.json());
      if (!verification.success) {
        await removeUploads();
        return res
          .status(400)
          .json({
            message:
              "reCAPTCHA verification failed or expired. Please try again.",
          });
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
            photo: {
              storedName: photo.filename,
              originalName: photo.originalname,
              mimeType: photo.mimetype,
              size: photo.size,
            },
            resume: {
              storedName: resume.filename,
              originalName: resume.originalname,
              mimeType: resume.mimetype,
              size: resume.size,
            },
          },
        },
      });
      return res
        .status(201)
        .json({
          message: "Membership application received",
          id: application.id,
          reference,
        });
    } catch (error) {
      await removeUploads().catch((cleanupError) =>
        console.error(
          "Membership application upload cleanup failed",
          cleanupError,
        ),
      );
      next(error);
    }
  },
);
app.get("/api/applications/:reference", async (req, res, next) => {
  try {
    const item = await prisma.application.findUnique({
      where: { reference: req.params.reference },
    });
    if (!item)
      return res.status(404).json({ message: "Application not found" });
    return res.json(item);
  } catch (error) {
    next(error);
  }
});
app.get("/api/journals", async (req, res, next) => {
  try {
    const query = String(req.query.q || "");
    const journals = await prisma.journal.findMany({
      where: query
        ? {
            OR: [
              { title: { contains: query } },
              { publisher: { contains: query } },
              { issn: { contains: query } },
            ],
          }
        : {},
      take: 50,
    });
    res.json(journals);
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof multer.MulterError)
      return res
        .status(400)
        .json({
          message:
            error.code === "LIMIT_FILE_SIZE"
              ? "An uploaded file exceeds the 5 MB limit."
              : error.message,
        });
    if (error instanceof Error && error.message.startsWith("Unsupported "))
      return res.status(400).json({ message: error.message });
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ message: "Validation failed", issues: error.issues });
    if (error instanceof Error && "statusCode" in error) {
      const statusCode = Number((error as Error & { statusCode: number }).statusCode);
      if (statusCode >= 400 && statusCode < 600)
        return res.status(statusCode).json({ message: error.message });
    }
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  },
);

const port = Number(process.env.PORT || 4000);
void ensureSourceActiveColumn().catch((error) =>
  console.error("Source status setup failed", error),
);
void ensurePublisherActiveColumn().catch((error) =>
  console.error("Publisher status setup failed", error),
);
void disableExpiredMembers().catch((error) =>
  console.error("Initial membership expiry check failed", error),
);
const membershipExpiryTimer = setInterval(
  () => {
    void disableExpiredMembers().catch((error) =>
      console.error("Scheduled membership expiry check failed", error),
    );
  },
  60 * 60 * 1000,
);
membershipExpiryTimer.unref();
app.listen(port, () =>
  console.log(`IJPAss API running on http://localhost:${port}`),
);
