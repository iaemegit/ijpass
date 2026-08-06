import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const assignments = [
  { manuscriptId: 1, subjectAreaId: 288 },
  { manuscriptId: 2, subjectAreaId: 289 },
  { manuscriptId: 3, subjectAreaId: 105 },
  { manuscriptId: 4, subjectAreaId: 290 },
  { manuscriptId: 5, subjectAreaId: 213 },
  { manuscriptId: 6, subjectAreaId: 226 },
  { manuscriptId: 7, subjectAreaId: 291 },
  { manuscriptId: 8, subjectAreaId: 33 },
  { manuscriptId: 9, subjectAreaId: 290 },
  { manuscriptId: 10, subjectAreaId: 204 },
  { manuscriptId: 11, subjectAreaId: 33 },
  { manuscriptId: 12, subjectAreaId: 138 },
  { manuscriptId: 18, subjectAreaId: 307 },
  { manuscriptId: 19, subjectAreaId: 343 },
  { manuscriptId: 20, subjectAreaId: 204 },
  { manuscriptId: 21, subjectAreaId: 306 },
  { manuscriptId: 22, subjectAreaId: 290 },
  { manuscriptId: 23, subjectAreaId: 290 },
  { manuscriptId: 24, subjectAreaId: 105 },
  { manuscriptId: 25, subjectAreaId: 213 },
  { manuscriptId: 26, subjectAreaId: 290 },
  { manuscriptId: 27, subjectAreaId: 213 },
  { manuscriptId: 33, subjectAreaId: 219 },
  { manuscriptId: 34, subjectAreaId: 290 },
  { manuscriptId: 35, subjectAreaId: 243 },
  { manuscriptId: 36, subjectAreaId: 213 },
  { manuscriptId: 37, subjectAreaId: 243 },
  { manuscriptId: 38, subjectAreaId: 109 },
  { manuscriptId: 39, subjectAreaId: 213 },
  { manuscriptId: 40, subjectAreaId: 331 },
  { manuscriptId: 41, subjectAreaId: 326 },
  { manuscriptId: 42, subjectAreaId: 213 },
  { manuscriptId: 48, subjectAreaId: 213 },
  { manuscriptId: 49, subjectAreaId: 213 },
  { manuscriptId: 50, subjectAreaId: 125 },
  { manuscriptId: 51, subjectAreaId: 284 },
  { manuscriptId: 52, subjectAreaId: 180 },
  { manuscriptId: 53, subjectAreaId: 100 },
  { manuscriptId: 54, subjectAreaId: 290 },
  { manuscriptId: 55, subjectAreaId: 298 },
  { manuscriptId: 56, subjectAreaId: 345 },
  { manuscriptId: 57, subjectAreaId: 291 },
  { manuscriptId: 63, subjectAreaId: 306 },
  { manuscriptId: 64, subjectAreaId: 213 },
  { manuscriptId: 65, subjectAreaId: 138 },
  { manuscriptId: 66, subjectAreaId: 345 },
  { manuscriptId: 67, subjectAreaId: 325 },
  { manuscriptId: 68, subjectAreaId: 204 },
  { manuscriptId: 69, subjectAreaId: 204 },
  { manuscriptId: 70, subjectAreaId: 204 },
  { manuscriptId: 71, subjectAreaId: 172 },
  { manuscriptId: 72, subjectAreaId: 290 },
  { manuscriptId: 78, subjectAreaId: 340 },
  { manuscriptId: 79, subjectAreaId: 299 },
  { manuscriptId: 80, subjectAreaId: 299 },
  { manuscriptId: 81, subjectAreaId: 325 },
  { manuscriptId: 82, subjectAreaId: 213 },
  { manuscriptId: 83, subjectAreaId: 303 },
  { manuscriptId: 85, subjectAreaId: 122 },
  { manuscriptId: 86, subjectAreaId: 290 },
  { manuscriptId: 87, subjectAreaId: 204 },
  { manuscriptId: 88, subjectAreaId: 4 },
  { manuscriptId: 89, subjectAreaId: 285 },
  { manuscriptId: 90, subjectAreaId: 290 },
  { manuscriptId: 91, subjectAreaId: 244 },
  { manuscriptId: 92, subjectAreaId: 14 },
  { manuscriptId: 93, subjectAreaId: 36 },
  { manuscriptId: 94, subjectAreaId: 226 },
  { manuscriptId: 100, subjectAreaId: 105 },
];

async function main() {
  const [column] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*) count FROM information_schema.columns
    WHERE table_schema='ijpass_journals' AND table_name='manuscript_tbl'
      AND column_name='subject_area_id'`);
  if (!Number(column?.count ?? 0)) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ijpass_journals.manuscript_tbl
      ADD COLUMN subject_area_id BIGINT UNSIGNED NULL AFTER keywords`);
    console.log("Added manuscript_tbl.subject_area_id.");
  }

  const [index] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*) count FROM information_schema.statistics
    WHERE table_schema='ijpass_journals' AND table_name='manuscript_tbl'
      AND index_name='idx_manuscript_subject_area'`);
  if (!Number(index?.count ?? 0)) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ijpass_journals.manuscript_tbl
      ADD INDEX idx_manuscript_subject_area (subject_area_id)`);
    console.log("Added manuscript subject-area index.");
  }

  const [constraint] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*) count FROM information_schema.referential_constraints
    WHERE constraint_schema='ijpass_journals'
      AND table_name='manuscript_tbl'
      AND constraint_name='fk_manuscript_subject_area'`);
  if (!Number(constraint?.count ?? 0)) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ijpass_journals.manuscript_tbl
      ADD CONSTRAINT fk_manuscript_subject_area
      FOREIGN KEY (subject_area_id)
      REFERENCES ijpass_journals.subject_area_tbl(subject_area_id)
      ON UPDATE CASCADE ON DELETE SET NULL`);
    console.log("Added manuscript subject-area foreign key.");
  }

  for (const assignment of assignments) {
    await prisma.$executeRawUnsafe(
      `UPDATE ijpass_journals.manuscript_tbl manuscript
       INNER JOIN ijpass_journals.subject_area_tbl subject
         ON subject.subject_area_id=?
       SET manuscript.subject_area_id=subject.subject_area_id
       WHERE manuscript.manuscript_id=?`,
      assignment.subjectAreaId,
      assignment.manuscriptId,
    );
  }
  console.log(`Assigned one subject area to ${assignments.length} manuscripts.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
