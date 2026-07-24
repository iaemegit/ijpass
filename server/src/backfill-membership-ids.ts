import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const categoryCodes: Record<string, string> = {
  'Student Member': 'STU', 'Individual Member': 'IND', 'Editor Member': 'EDT', 'Journal Member': 'JRN',
  'Publisher Member': 'PUB', 'Institutional Member': 'INS', 'Corporate Member': 'COR',
  'Life Member (Individual)': 'LIF', 'Honorary Member': 'HON', 'Fellow (FIJPAss)': 'FIJ'
};
const codeFor = (name: string) => categoryCodes[name] || name
  .replace(/\([^)]*\)/g, ' ')
  .split(/\s+/)
  .filter(word => word && !['member', 'membership', 'and', 'of', 'the'].includes(word.toLowerCase()))
  .map(word => word[0]).join('').toUpperCase().padEnd(3, 'X').slice(0, 3);
const expiryFor = (from: Date, validity: string) => {
  if (/life\s*time/i.test(validity)) return null;
  const years = validity.match(/(\d+)\s*years?/i);
  const months = validity.match(/(\d+)\s*months?/i);
  const until = new Date(from);
  if (years) { until.setUTCFullYear(until.getUTCFullYear() + Number(years[1])); return until; }
  if (months) { until.setUTCMonth(until.getUTCMonth() + Number(months[1])); return until; }
  return null;
};

try {
  const members = await prisma.member.findMany({ include: { membershipCategory: { select: { name: true, validity: true } } } });
  await Promise.all(members.map(member => prisma.member.update({
    where: { id: member.id },
    data: {
      membershipFrom: member.membershipFrom || member.createdAt,
      membershipUntil: expiryFor(member.membershipFrom || member.createdAt, member.membershipCategory.validity),
      membershipId: `IJPASS-${codeFor(member.membershipCategory.name)}-2K${String((member.membershipFrom || member.createdAt).getUTCFullYear() % 100).padStart(2, '0')}-${String(member.id).padStart(6, '0')}`
    }
  })));
  console.log(`Membership dates and year-coded IDs updated for ${members.length} existing member(s).`);
} finally {
  await prisma.$disconnect();
}
