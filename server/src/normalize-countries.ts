import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const corrections = new Map<string, string>([
  ["Indiaq", "India"],
  ["India.", "India"],
  ["Kennya", "Kenya"],
  ["Mexico.", "Mexico"],
  ["Portugal.", "Portugal"],
  ["USA", "United States"],
  ["USA.", "United States"],
  ["United States of America", "United States"],
  ["United State of America", "United States"],
  ["UAE", "United Arab Emirates"],
  ["KSA", "Saudi Arabia"],
  ["Great Britain", "United Kingdom"],
  ["Taiwan R.O.C.", "Taiwan"],
  ["The United Republic of Tanzania", "Tanzania"],
  ["Jamaica W.I.", "Jamaica"],
  ["Vatican", "Vatican City"],
  ["Tamil Nadu, India", "India"],
  ["Hyderabad", "India"],
  ["Andaman & Nicobar Islands", "India"],
  ["Telangana, 508206", "India"],
  ["Berlin", "Germany"],
  ["Denver", "United States"],
  ["New York", "United States"],
  ["Washington", "United States"],
  ["London", "United Kingdom"],
  ["Paris", "France"],
  ["Madeira", "Portugal"],
  ["Port Harcourt", "Nigeria"],
]);

async function main() {
  const sourceValues = [...corrections.keys()];
  const before = await prisma.$queryRawUnsafe<Array<{ country: string; records: bigint }>>(
    `SELECT country,COUNT(*) records FROM ijpass_journals.affiliationdata_tbl WHERE country IN (${sourceValues.map(() => "?").join(",")}) GROUP BY country ORDER BY country`,
    ...sourceValues,
  );
  const changed = await prisma.$transaction(async (transaction) => {
    let normalized = 0;
    for (const [source, destination] of corrections) {
      const sourceRows = await transaction.$queryRawUnsafe<Array<{ id: bigint; university: string; address: string }>>(
        "SELECT affiliation_id id,university_company university,address FROM ijpass_journals.affiliationdata_tbl WHERE country=?",
        source,
      );
      for (const row of sourceRows) {
        const duplicate = await transaction.$queryRawUnsafe<Array<{ id: bigint }>>(
          "SELECT affiliation_id id FROM ijpass_journals.affiliationdata_tbl WHERE university_company=? AND address=? AND country=? AND affiliation_id<>? LIMIT 1",
          row.university,
          row.address,
          destination,
          row.id,
        );
        if (duplicate[0]) {
          await transaction.$executeRawUnsafe(
            "INSERT IGNORE INTO ijpass_journals.author_affiliation_tbl(author_profile_id,affiliation_id,start_year,end_year,is_current,created_at,updated_at) SELECT author_profile_id,?,start_year,end_year,is_current,created_at,updated_at FROM ijpass_journals.author_affiliation_tbl WHERE affiliation_id=?",
            duplicate[0].id,
            row.id,
          );
          await transaction.$executeRawUnsafe("DELETE FROM ijpass_journals.author_affiliation_tbl WHERE affiliation_id=?", row.id);
          await transaction.$executeRawUnsafe("DELETE FROM ijpass_journals.affiliationdata_tbl WHERE affiliation_id=?", row.id);
        } else {
          await transaction.$executeRawUnsafe("UPDATE ijpass_journals.affiliationdata_tbl SET country=? WHERE affiliation_id=?", destination, row.id);
        }
        normalized += 1;
      }
    }
    return normalized;
  });
  const remaining = await prisma.$queryRawUnsafe<Array<{ country: string; records: bigint }>>(
    `SELECT country,COUNT(*) records FROM ijpass_journals.affiliationdata_tbl WHERE country IN (${sourceValues.map(() => "?").join(",")}) GROUP BY country ORDER BY country`,
    ...sourceValues,
  );
  console.log(`Normalized ${changed} affiliation country record(s) across ${before.length} source value(s).`);
  console.log(`Unresolved mapped values: ${remaining.length}.`);
}

main().finally(() => prisma.$disconnect());
