import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const fromId = Number(process.argv[2] || 11);
const toId = Number(process.argv[3] || 100);

async function main() {
  if (process.argv.includes("--summary")) {
    const [summary] = await prisma.$queryRawUnsafe<Array<{
      total: bigint;
      assigned: bigint;
      unassigned: bigint;
      unassignedWithKeywords: bigint;
      unassignedWithSourceSubject: bigint;
      minimumId: bigint | null;
      maximumId: bigint | null;
    }>>(`SELECT COUNT(*) total,COUNT(subject_area_id) assigned,
        SUM(subject_area_id IS NULL) unassigned,
        SUM(subject_area_id IS NULL AND NULLIF(TRIM(keywords),'') IS NOT NULL) unassignedWithKeywords,
        SUM(subject_area_id IS NULL AND EXISTS (
          SELECT 1 FROM ijpass_journals.sourcedata_tbl source
          WHERE source.source_data_id=manuscript.journal_id
            AND NULLIF(TRIM(source.subject_area),'') IS NOT NULL
        )) unassignedWithSourceSubject,
        MIN(CASE WHEN subject_area_id IS NULL THEN manuscript_id END) minimumId,
        MAX(CASE WHEN subject_area_id IS NULL THEN manuscript_id END) maximumId
      FROM ijpass_journals.manuscript_tbl manuscript`);
    console.log(JSON.stringify(summary, (_key, value) => typeof value === "bigint" ? Number(value) : value, 2));
    return;
  }

  if (process.argv.includes("--unassigned-journals")) {
    const journals = await prisma.$queryRawUnsafe<Array<{
      journalId: bigint;
      journalTitle: string;
      manuscripts: bigint;
    }>>(`SELECT manuscript.journal_id journalId,source.journal_title journalTitle,
        COUNT(*) manuscripts
      FROM ijpass_journals.manuscript_tbl manuscript
      INNER JOIN ijpass_journals.sourcedata_tbl source
        ON source.source_data_id=manuscript.journal_id
      WHERE manuscript.subject_area_id IS NULL
      GROUP BY manuscript.journal_id,source.journal_title
      ORDER BY manuscripts DESC,journalTitle`);
    console.log(JSON.stringify(journals, (_key, value) => typeof value === "bigint" ? Number(value) : value, 2));
    return;
  }


  if (process.argv.includes("--subjects")) {
    const subjectAreas = await prisma.$queryRawUnsafe<Array<{
      id: bigint;
      majorSubject: string;
      classificationName: string;
      subjectArea: string;
    }>>(`SELECT subject_area_id id, major_subject majorSubject,
        classification_name classificationName, subject_area subjectArea
      FROM ijpass_journals.subject_area_tbl
      ORDER BY subject_area_id`);
    console.log(JSON.stringify(subjectAreas, (_key, value) =>
      typeof value === "bigint" ? Number(value) : value, 2));
    return;
  }

  const findIndex = process.argv.indexOf("--find");
  if (findIndex >= 0) {
    const terms = process.argv.slice(findIndex + 1).map((value) => value.toLocaleLowerCase("en"));
    const subjectAreas = await prisma.$queryRawUnsafe<Array<{
      id: bigint;
      majorSubject: string;
      classificationName: string;
      subjectArea: string;
    }>>(`SELECT subject_area_id id, major_subject majorSubject,
        classification_name classificationName, subject_area subjectArea
      FROM ijpass_journals.subject_area_tbl
      ORDER BY subject_area_id`);
    for (const subject of subjectAreas) {
      const haystack = `${subject.majorSubject} ${subject.classificationName} ${subject.subjectArea}`.toLocaleLowerCase("en");
      if (terms.some((term) => haystack.includes(term))) {
        console.log(`${subject.id}\t${subject.majorSubject}\t${subject.classificationName}\t${subject.subjectArea}`);
      }
    }
    return;
  }

  const manuscripts = await prisma.$queryRawUnsafe<Array<{
    id: bigint;
    title: string;
    keywords: string | null;
    sourceSubject: string | null;
    currentSubjectAreaId: bigint | null;
    currentSubjectArea: string | null;
  }>>(
    `SELECT manuscript.manuscript_id id, manuscript.article_title title,
       manuscript.keywords, source.subject_area sourceSubject,
       manuscript.subject_area_id currentSubjectAreaId,
       subject.subject_area currentSubjectArea
     FROM ijpass_journals.manuscript_tbl manuscript
     LEFT JOIN ijpass_journals.sourcedata_tbl source
       ON source.source_data_id=manuscript.journal_id
     LEFT JOIN ijpass_journals.subject_area_tbl subject
       ON subject.subject_area_id=manuscript.subject_area_id
     WHERE manuscript.manuscript_id BETWEEN ? AND ?
     ORDER BY manuscript.manuscript_id`,
    fromId,
    toId,
  );

  console.log(JSON.stringify(manuscripts, (_key, value) =>
    typeof value === "bigint" ? Number(value) : value, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
