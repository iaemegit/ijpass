import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import { z } from 'zod';

const env = z.object({
  SUPER_ADMIN_EMAIL: z.string().email(),
  SUPER_ADMIN_PASSWORD: z.string().min(12),
  SUPER_ADMIN_NAME: z.string().min(2).default('IJPAss Super Admin')
}).parse(process.env);

const prisma = new PrismaClient();
try {
  const password = await bcrypt.hash(env.SUPER_ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: env.SUPER_ADMIN_EMAIL.toLowerCase() },
    update: { name: env.SUPER_ADMIN_NAME, password, role: UserRole.SUPER_ADMIN, active: true },
    create: { email: env.SUPER_ADMIN_EMAIL.toLowerCase(), name: env.SUPER_ADMIN_NAME, password, role: UserRole.SUPER_ADMIN }
  });
  console.log(`Super Admin account ready: ${admin.email}`);
} finally {
  await prisma.$disconnect();
}
