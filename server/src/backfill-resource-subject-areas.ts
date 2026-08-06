import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [before] = await prisma.$queryRawUnsafe<Array<{
    resources: bigint;
    unclassified: bigint;
    manuscriptsWithoutSubject: bigint;
  }>>(`SELECT
      (SELECT COUNT(*) FROM ijpass_journals.sourcedata_tbl) resources,
      (SELECT COUNT(*) FROM ijpass_journals.sourcedata_tbl
        WHERE NULLIF(TRIM(subject_area),'') IS NULL) unclassified,
      (SELECT COUNT(*) FROM ijpass_journals.manuscript_tbl
        WHERE subject_area_id IS NULL) manuscriptsWithoutSubject`);

  if (Number(before.manuscriptsWithoutSubject)) {
    throw new Error(
      `${Number(before.manuscriptsWithoutSubject)} manuscripts have no subject area. ` +
      "Assign manuscript subject areas before deriving resource subjects.",
    );
  }

  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
    try {
      return await transaction.$executeRawUnsafe(`
        UPDATE ijpass_journals.sourcedata_tbl source
        INNER JOIN (
          SELECT ranked.journal_id,ranked.subject_area
          FROM (
            SELECT manuscript.journal_id,subject.subject_area,
              ROW_NUMBER() OVER (
                PARTITION BY manuscript.journal_id
                ORDER BY COUNT(*) DESC,subject.subject_area_id ASC
              ) subject_rank
            FROM ijpass_journals.manuscript_tbl manuscript
            INNER JOIN ijpass_journals.subject_area_tbl subject
              ON subject.subject_area_id=manuscript.subject_area_id
            GROUP BY manuscript.journal_id,subject.subject_area_id,subject.subject_area
          ) ranked
          WHERE ranked.subject_rank=1
        ) primary_subject ON primary_subject.journal_id=source.source_data_id
        SET source.subject_area=primary_subject.subject_area
      `);
    } finally {
      await transaction.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
    }
  }, { timeout: 30_000 });

  const [after] = await prisma.$queryRawUnsafe<Array<{
    classified: bigint;
    unclassified: bigint;
  }>>(`SELECT
      SUM(NULLIF(TRIM(subject_area),'') IS NOT NULL) classified,
      SUM(NULLIF(TRIM(subject_area),'') IS NULL) unclassified
    FROM ijpass_journals.sourcedata_tbl`);
  const leadingSubjects = await prisma.$queryRawUnsafe<Array<{
    subjectArea: string;
    resources: bigint;
  }>>(`SELECT subject_area subjectArea,COUNT(*) resources
    FROM ijpass_journals.sourcedata_tbl
    WHERE NULLIF(TRIM(subject_area),'') IS NOT NULL
    GROUP BY subject_area
    ORDER BY resources DESC,subject_area
    LIMIT 10`);

  console.log(
    `Resource subject backfill complete: ${updated} rows updated; ` +
    `${Number(after.classified)} classified; ${Number(after.unclassified)} unclassified.`,
  );
  console.log("Largest primary-subject groups:");
  for (const row of leadingSubjects) {
    console.log(`  ${Number(row.resources)}\t${row.subjectArea}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
