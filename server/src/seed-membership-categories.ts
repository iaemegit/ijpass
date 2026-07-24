import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const categories = [
  ['Student Member', 'Undergraduate, postgraduate, and research scholars', '1 Year', '15', '1,000'],
  ['Individual Member', 'Researchers, authors, reviewers, academicians, librarians', '1 Year', '30', '2,500'],
  ['Editor Member', 'Editors, Associate Editors, Editorial Board Members', '1 Year', '50', '4,000'],
  ['Journal Member', 'Individual scholarly journal', '1 Year', '100', '8,000'],
  ['Publisher Member', 'Publishing organizations managing multiple journals', '1 Year', '250', '20,000'],
  ['Institutional Member', 'Universities, colleges, research institutions, libraries', '1 Year', '300', '25,000'],
  ['Corporate Member', 'Companies supporting scholarly publishing', '1 Year', '500', '40,000'],
  ['Life Member (Individual)', 'Individual professionals', 'Lifetime', '300', '25,000'],
  ['Honorary Member', 'Eminent scholars and distinguished contributors', 'Lifetime', 'By Invitation', 'No Fee'],
  ['Fellow (FIJPAss)', 'Senior professionals with outstanding contributions', '5 Years / Renewable', '200', '15,000']
] as const;

try {
  const existing = await prisma.membershipCategory.findMany({ select: { id: true, usd: true, inr: true } });
  await Promise.all(existing.map(category => prisma.membershipCategory.update({
    where: { id: category.id },
    data: { usd: category.usd.replace(/^[\$₹]\s*/u, ''), inr: category.inr.replace(/^[\$₹]\s*/u, '') }
  })));
  const result = await prisma.membershipCategory.createMany({
    data: categories.map(([name, eligibility, validity, usd, inr], sortOrder) => ({ name, eligibility, validity, usd, inr, sortOrder })),
    skipDuplicates: true
  });
  console.log(`Membership categories ready. Added ${result.count} new record(s).`);
} finally {
  await prisma.$disconnect();
}
