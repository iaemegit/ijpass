import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const profileColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`
    SELECT COLUMN_NAME name
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA='ijpass_journals'
      AND TABLE_NAME='author_profile_tbl'
      AND COLUMN_NAME IN ('department','designation')
  `);
  const existingProfileColumns = new Set(profileColumns.map((column) => column.name));
  if (!existingProfileColumns.has("department")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE ijpass_journals.author_profile_tbl ADD COLUMN department VARCHAR(500) NULL AFTER author_name",
    );
    console.log("Added author-profile department field.");
  }
  if (!existingProfileColumns.has("designation")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE ijpass_journals.author_profile_tbl ADD COLUMN designation VARCHAR(500) NULL AFTER department",
    );
    console.log("Added author-profile designation field.");
  }
  const constraints = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`
    SELECT CONSTRAINT_NAME name
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA='ijpass_journals'
      AND TABLE_NAME='authordata_tbl'
      AND REFERENCED_TABLE_NAME='tbl_author'
  `);
  const parentTables = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`
    SELECT COUNT(*) total FROM information_schema.TABLES
    WHERE TABLE_SCHEMA='ijpass_journals' AND TABLE_NAME='tbl_author'
  `);
  if (Number(parentTables[0]?.total || 0) > 0) {
    console.log("Legacy tbl_author exists; no constraint change required.");
    return;
  }
  for (const constraint of constraints) {
    if (!/^[A-Za-z0-9_]+$/.test(constraint.name)) throw new Error("Unexpected foreign-key name");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ijpass_journals.authordata_tbl DROP FOREIGN KEY \`${constraint.name}\``,
    );
    console.log(`Removed orphan foreign key: ${constraint.name}`);
  }
  if (!constraints.length) console.log("Manuscript author-entry schema is already ready.");
}

main().finally(() => prisma.$disconnect());
