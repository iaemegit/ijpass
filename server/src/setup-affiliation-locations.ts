import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [column] = await prisma.$queryRawUnsafe<Array<{ columnCount: bigint }>>(
    `SELECT COUNT(*) columnCount FROM information_schema.columns
     WHERE table_schema='ijpass_journals'
       AND table_name='affiliationdata_tbl'
       AND column_name='city_territory'`,
  );

  if (!Number(column?.columnCount ?? 0)) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ijpass_journals.affiliationdata_tbl
       ADD COLUMN city_territory VARCHAR(255) NOT NULL DEFAULT '' AFTER university_company`,
    );
    console.log("Added affiliationdata_tbl.city_territory.");
  } else {
    console.log("affiliationdata_tbl.city_territory already exists.");
  }

  const updated = await prisma.$executeRawUnsafe(
    `UPDATE ijpass_journals.affiliationdata_tbl
     SET university_company='Rathinam Global University', city_territory='Coimbatore'
     WHERE affiliation_id=120
       AND TRIM(university_company)='Rathinam Global University, Coimbatore'
       AND TRIM(COALESCE(city_territory,''))=''`,
  );
  console.log(`Updated Affiliation ID 120: ${updated ? "yes" : "already separated or not found"}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
