import "dotenv/config";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const workbookPath = resolve(process.argv[2] || process.env.SUBJECT_AREA_XLSX_PATH || "subjectarea.xlsx");

type SubjectAreaRow = {
  recordKey: string;
  majorSubject: string;
  classificationName: string;
  subjectArea: string;
};

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook does not contain a worksheet.");

  const headers = [1, 2, 3].map((column) => clean(worksheet.getCell(1, column).text).toLowerCase());
  if (headers.join("|") !== "major subject|classification name|subject area") {
    throw new Error("Expected columns: Major Subject, Classification Name, Subject Area.");
  }

  const uniqueRows = new Map<string, SubjectAreaRow>();
  let populatedRows = 0;
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const majorSubject = clean(worksheet.getCell(rowNumber, 1).text);
    const classificationName = clean(worksheet.getCell(rowNumber, 2).text);
    const subjectArea = clean(worksheet.getCell(rowNumber, 3).text);
    if (!majorSubject && !classificationName && !subjectArea) continue;
    populatedRows += 1;
    if (!majorSubject || !classificationName || !subjectArea) {
      throw new Error(`Row ${rowNumber} has a missing required value.`);
    }
    const identity = `${majorSubject}\u0000${classificationName}\u0000${subjectArea}`.toLocaleLowerCase("en");
    uniqueRows.set(identity, {
      recordKey: createHash("sha256").update(identity).digest("hex"),
      majorSubject,
      classificationName,
      subjectArea,
    });
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ijpass_journals.subject_area_tbl (
      subject_area_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      record_key CHAR(64) NOT NULL,
      major_subject VARCHAR(255) NOT NULL,
      classification_name VARCHAR(255) NOT NULL,
      subject_area VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (subject_area_id),
      UNIQUE KEY uq_subject_area_record_key (record_key),
      KEY idx_subject_area_major (major_subject),
      KEY idx_subject_area_classification (classification_name),
      KEY idx_subject_area_name (subject_area)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const rows = [...uniqueRows.values()];
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    await prisma.$transaction(batch.map((row) => prisma.$executeRawUnsafe(
      `INSERT INTO ijpass_journals.subject_area_tbl
        (record_key,major_subject,classification_name,subject_area)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE
        major_subject=VALUES(major_subject),
        classification_name=VALUES(classification_name),
        subject_area=VALUES(subject_area)`,
      row.recordKey,
      row.majorSubject,
      row.classificationName,
      row.subjectArea,
    )));
  }

  const [summary] = await prisma.$queryRawUnsafe<Array<{
    records: bigint;
    majorSubjects: bigint;
    classifications: bigint;
  }>>(`SELECT COUNT(*) records,COUNT(DISTINCT major_subject) majorSubjects,
        COUNT(DISTINCT classification_name) classifications
      FROM ijpass_journals.subject_area_tbl`);

  console.log(`Workbook: ${workbookPath}`);
  console.log(`Rows read: ${populatedRows}; unique rows imported: ${rows.length}; duplicates skipped: ${populatedRows - rows.length}.`);
  console.log(`Database table contains ${Number(summary.records)} records, ${Number(summary.majorSubjects)} major subjects, and ${Number(summary.classifications)} classifications.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
