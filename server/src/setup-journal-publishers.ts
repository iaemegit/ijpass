import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ijpass_journals.publisher_tbl (
      publisher_id INT NOT NULL AUTO_INCREMENT,
      publisher_name VARCHAR(255) NOT NULL,
      chief_editor VARCHAR(255) NULL,
      email VARCHAR(255) NULL,
      website VARCHAR(500) NULL,
      address TEXT NULL,
      country VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (publisher_id),
      UNIQUE KEY uq_publisher_name (publisher_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
    try {
      const columns = await tx.$queryRawUnsafe<Array<{ columnCount: bigint }>>(`
        SELECT COUNT(*) AS columnCount FROM information_schema.columns
        WHERE table_schema='ijpass_journals' AND table_name='sourcedata_tbl' AND column_name='publisher_id'
      `);
      if (!Number(columns[0]?.columnCount || 0)) {
        await tx.$executeRawUnsafe(`ALTER TABLE ijpass_journals.sourcedata_tbl ADD COLUMN publisher_id INT NULL AFTER source_type`);
      }
      await tx.$executeRawUnsafe(`INSERT INTO ijpass_journals.publisher_tbl (publisher_name) VALUES ('IAEME Publication') ON DUPLICATE KEY UPDATE publisher_name = VALUES(publisher_name)`);
      await tx.$executeRawUnsafe(`UPDATE ijpass_journals.sourcedata_tbl SET publisher_id = (SELECT publisher_id FROM ijpass_journals.publisher_tbl WHERE publisher_name = 'IAEME Publication' LIMIT 1), publisher = 'IAEME Publication'`);
    } finally {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }
  });
  const [summary] = await prisma.$queryRawUnsafe<Array<{ publishers: bigint; sources: bigint; linked: bigint }>>(`
    SELECT (SELECT COUNT(*) FROM ijpass_journals.publisher_tbl) publishers,
      (SELECT COUNT(*) FROM ijpass_journals.sourcedata_tbl) sources,
      (SELECT COUNT(*) FROM ijpass_journals.sourcedata_tbl WHERE publisher_id IS NOT NULL) linked
  `);
  console.log(`Journal publisher table ready: ${Number(summary.publishers)} publisher(s), ${Number(summary.linked)} of ${Number(summary.sources)} sources linked.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
