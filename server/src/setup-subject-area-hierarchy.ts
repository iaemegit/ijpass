import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function count(sql: string) {
  const [row] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(sql);
  return Number(row?.count ?? 0);
}

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ijpass_journals.major_subject_tbl (
      major_subject_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      major_subject VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (major_subject_id),
      UNIQUE KEY uq_major_subject_name (major_subject)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ijpass_journals.subject_classification_tbl (
      classification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      major_subject_id BIGINT UNSIGNED NOT NULL,
      classification_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (classification_id),
      UNIQUE KEY uq_subject_classification (major_subject_id, classification_name),
      KEY idx_subject_classification_name (classification_name),
      CONSTRAINT fk_subject_classification_major
        FOREIGN KEY (major_subject_id)
        REFERENCES ijpass_journals.major_subject_tbl(major_subject_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO ijpass_journals.major_subject_tbl (major_subject)
    SELECT DISTINCT TRIM(major_subject)
    FROM ijpass_journals.subject_area_tbl
    WHERE TRIM(major_subject)<>''
  `);

  await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO ijpass_journals.subject_classification_tbl
      (major_subject_id, classification_name)
    SELECT major.major_subject_id, TRIM(subject.classification_name)
    FROM ijpass_journals.subject_area_tbl subject
    INNER JOIN ijpass_journals.major_subject_tbl major
      ON major.major_subject=TRIM(subject.major_subject)
    WHERE TRIM(subject.classification_name)<>''
    GROUP BY major.major_subject_id, TRIM(subject.classification_name)
  `);

  const hasClassificationColumn = await count(`
    SELECT COUNT(*) count FROM information_schema.columns
    WHERE table_schema='ijpass_journals' AND table_name='subject_area_tbl'
      AND column_name='classification_id'
  `);
  if (!hasClassificationColumn) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ijpass_journals.subject_area_tbl
      ADD COLUMN classification_id BIGINT UNSIGNED NULL AFTER subject_area_id
    `);
  }

  await prisma.$executeRawUnsafe(`
    UPDATE ijpass_journals.subject_area_tbl subject
    INNER JOIN ijpass_journals.major_subject_tbl major
      ON major.major_subject=TRIM(subject.major_subject)
    INNER JOIN ijpass_journals.subject_classification_tbl classification
      ON classification.major_subject_id=major.major_subject_id
      AND classification.classification_name=TRIM(subject.classification_name)
    SET subject.classification_id=classification.classification_id
  `);

  const hasClassificationIndex = await count(`
    SELECT COUNT(*) count FROM information_schema.statistics
    WHERE table_schema='ijpass_journals' AND table_name='subject_area_tbl'
      AND index_name='idx_subject_area_classification_id'
  `);
  if (!hasClassificationIndex) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ijpass_journals.subject_area_tbl
      ADD INDEX idx_subject_area_classification_id (classification_id)
    `);
  }

  const hasClassificationConstraint = await count(`
    SELECT COUNT(*) count FROM information_schema.referential_constraints
    WHERE constraint_schema='ijpass_journals'
      AND table_name='subject_area_tbl'
      AND constraint_name='fk_subject_area_classification'
  `);
  if (!hasClassificationConstraint) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ijpass_journals.subject_area_tbl
      ADD CONSTRAINT fk_subject_area_classification
        FOREIGN KEY (classification_id)
        REFERENCES ijpass_journals.subject_classification_tbl(classification_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    `);
  }

  const [summary] = await prisma.$queryRawUnsafe<Array<{
    majorSubjects: bigint;
    classifications: bigint;
    subjectAreas: bigint;
    linkedSubjectAreas: bigint;
  }>>(`
    SELECT
      (SELECT COUNT(*) FROM ijpass_journals.major_subject_tbl) majorSubjects,
      (SELECT COUNT(*) FROM ijpass_journals.subject_classification_tbl) classifications,
      COUNT(*) subjectAreas,
      COUNT(classification_id) linkedSubjectAreas
    FROM ijpass_journals.subject_area_tbl
  `);

  console.log(
    `Subject hierarchy ready: ${Number(summary.majorSubjects)} major subjects, ` +
    `${Number(summary.classifications)} classifications, ` +
    `${Number(summary.linkedSubjectAreas)}/${Number(summary.subjectAreas)} subject areas linked.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
