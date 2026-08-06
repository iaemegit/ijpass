import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import he from "he";

const prisma = new PrismaClient();
const entitySqlPattern = "&(#([xX][0-9A-Fa-f]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);";
const textTargets = [
  { table: "manuscript_tbl", key: "manuscript_id", column: "article_title" },
  { table: "manuscript_tbl", key: "manuscript_id", column: "abstract" },
  { table: "refdat_table", key: "reference_id", column: "authors_name" },
  { table: "refdat_table", key: "reference_id", column: "article_title" },
  { table: "refdat_table", key: "reference_id", column: "source_title" },
  { table: "refdat_table", key: "reference_id", column: "issue" },
  { table: "refdat_table", key: "reference_id", column: "raw_reference" },
] as const;

const cleanCredentials = (value: string) => value
  .replace(/(?:\s*,\s*|\s+)(?:Ph\.?\s*D\.?|D\.?\s*Sc\.?)\s*,?/gi, " ")
  .replace(/\s{2,}/g, " ")
  .replace(/\s+,/g, ",")
  .replace(/^[\s,]+|[\s,]+$/g, "")
  .trim();

function decodeFully(value: string) {
  let result = value;
  for (let pass = 0; pass < 4; pass += 1) {
    const decoded = he.decode(result, { isAttributeValue: false });
    if (decoded === result) break;
    result = decoded;
  }
  return result;
}

async function main() {
  const summary: Array<{ target: string; rows: number }> = [];
  await prisma.$transaction(async (transaction) => {
    for (const target of [
      { table: "authordata_tbl", key: "author_data_id" },
      { table: "author_profile_tbl", key: "author_profile_id" },
    ]) {
      const rows = await transaction.$queryRawUnsafe<Array<{ id: bigint; name: string }>>(
        `SELECT \`${target.key}\` id,author_name name FROM ijpass_journals.\`${target.table}\` WHERE LOWER(author_name) REGEXP 'ph[.]?[[:space:]]*d|d[.]?[[:space:]]*sc'`,
      );
      let changed = 0;
      for (const row of rows) {
        const cleaned = cleanCredentials(row.name);
        if (cleaned === row.name) continue;
        await transaction.$executeRawUnsafe(
          `UPDATE ijpass_journals.\`${target.table}\` SET author_name=? WHERE \`${target.key}\`=? AND author_name=?`,
          cleaned,
          row.id,
          row.name,
        );
        changed += 1;
      }
      summary.push({ target: `${target.table}.author_name`, rows: changed });
    }

    for (const target of textTargets) {
      const rows = await transaction.$queryRawUnsafe<Array<{ id: bigint; value: string }>>(
        `SELECT \`${target.key}\` id,\`${target.column}\` value FROM ijpass_journals.\`${target.table}\` WHERE \`${target.column}\` REGEXP ?`,
        entitySqlPattern,
      );
      let changed = 0;
      for (const row of rows) {
        const cleaned = decodeFully(row.value);
        if (cleaned === row.value) continue;
        await transaction.$executeRawUnsafe(
          `UPDATE ijpass_journals.\`${target.table}\` SET \`${target.column}\`=? WHERE \`${target.key}\`=? AND \`${target.column}\`=?`,
          cleaned,
          row.id,
          row.value,
        );
        changed += 1;
      }
      summary.push({ target: `${target.table}.${target.column}`, rows: changed });
    }

    const fixedLinks = await transaction.$executeRawUnsafe(
      "UPDATE ijpass_journals.refdat_table SET article_link=REPLACE(article_link,'&reg;=','&reg=') WHERE article_link LIKE '%&reg;=%'",
    );
    summary.push({ target: "refdat_table.article_link", rows: fixedLinks });
  }, { timeout: 180_000 });

  console.log(JSON.stringify({
    summary,
    totalRowsUpdated: summary.reduce((sum, item) => sum + item.rows, 0),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
