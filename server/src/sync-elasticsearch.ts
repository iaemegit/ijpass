import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type { estypes } from "@elastic/elasticsearch";
import { elastic } from "./elasticsearch.js";

const prisma = new PrismaClient();
const prefix = "ijpass";
const recreate = async (
  index: string,
  properties: Record<string, estypes.MappingProperty>,
) => {
  const exists = await elastic!.indices.exists({ index });
  if (exists) await elastic!.indices.delete({ index });
  await elastic!.indices.create({
    index,
    settings: { number_of_shards: 1, number_of_replicas: 0 },
    mappings: { properties },
  });
};
const bulk = async (
  index: string,
  records: Array<Record<string, unknown> & { id: string | number }>,
) => {
  if (!records.length) return;
  const operations = records.flatMap((record) => [
    { index: { _index: index, _id: String(record.id) } },
    record,
  ]);
  const response = await elastic!.bulk({ refresh: true, operations });
  if (response.errors) {
    const failures = response.items
      .filter((item) => item.index?.error)
      .slice(0, 5);
    throw new Error(`Bulk indexing failed: ${JSON.stringify(failures)}`);
  }
};

async function main() {
  if (!elastic) throw new Error("ELASTICSEARCH_URL is not configured.");
  await elastic.ping();
  const resources = await prisma.$queryRaw<
    Array<{
      id: bigint;
      title: string;
      abbreviation: string | null;
      subject: string | null;
      publisher: string | null;
      type: string | null;
    }>
  >`SELECT source.source_data_id id,source.journal_title title,source.abbreviation,source.subject_area subject,COALESCE(publisher.publisher_name,source.publisher) publisher,COALESCE(source.source_type,'Journal') type FROM ijpass_journals.sourcedata_tbl source LEFT JOIN ijpass_journals.publisher_tbl publisher ON publisher.publisher_id=source.publisher_id WHERE COALESCE(source.active,1)=1 AND COALESCE(publisher.active,1)=1`;
  const manuscripts = await prisma.$queryRaw<
    Array<{ journalId: bigint; title: string }>
  >`SELECT journal_id journalId,article_title title FROM ijpass_journals.manuscript_tbl WHERE article_title IS NOT NULL`;
  const manuscriptMap = new Map<string, string[]>();
  for (const row of manuscripts) {
    const key = String(row.journalId),
      items = manuscriptMap.get(key) || [];
    items.push(row.title);
    manuscriptMap.set(key, items);
  }
  const authors = await prisma.$queryRaw<
    Array<{
      id: bigint;
      salutation: string | null;
      name: string;
      orcid: string | null;
      affiliation: string | null;
      country: string | null;
      papers: bigint;
    }>
  >`SELECT profile.author_profile_id id,profile.salutation,profile.author_name name,profile.orcid,MAX(affiliation.university_company) affiliation,MAX(affiliation.country) country,COUNT(DISTINCT authorship.manuscript_id) papers FROM ijpass_journals.author_profile_tbl profile LEFT JOIN ijpass_journals.author_affiliation_tbl link ON link.author_profile_id=profile.author_profile_id AND link.is_current=1 LEFT JOIN ijpass_journals.affiliationdata_tbl affiliation ON affiliation.affiliation_id=link.affiliation_id LEFT JOIN ijpass_journals.manuscript_author_tbl authorship ON authorship.author_profile_id=profile.author_profile_id GROUP BY profile.author_profile_id,profile.salutation,profile.author_name,profile.orcid`;
  const affiliations = await prisma.$queryRaw<
    Array<{
      id: bigint;
      name: string;
      cityTerritory: string | null;
      address: string | null;
      country: string | null;
      authors: bigint;
      papers: bigint;
    }>
  >`SELECT affiliation.affiliation_id id,affiliation.university_company name,affiliation.city_territory cityTerritory,affiliation.address,affiliation.country,COUNT(DISTINCT authorship.author_profile_id) authors,COUNT(DISTINCT authorship.manuscript_id) papers FROM ijpass_journals.affiliationdata_tbl affiliation LEFT JOIN ijpass_journals.authordata_tbl source_author ON LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company))) IN (LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company))),LOWER(TRIM(LEADING ', ' FROM TRIM(CONCAT(affiliation.university_company,IF(TRIM(COALESCE(affiliation.city_territory,''))='','',CONCAT(', ',affiliation.city_territory))))))) LEFT JOIN ijpass_journals.manuscript_author_tbl authorship ON authorship.author_data_id=source_author.author_data_id GROUP BY affiliation.affiliation_id,affiliation.university_company,affiliation.city_territory,affiliation.address,affiliation.country`;
  const countries = await prisma.$queryRaw<
    Array<{
      country: string;
      affiliations: bigint;
      authors: bigint;
      papers: bigint;
    }>
  >`SELECT affiliation.country,COUNT(DISTINCT affiliation.affiliation_id) affiliations,COUNT(DISTINCT authorship.author_profile_id) authors,COUNT(DISTINCT authorship.manuscript_id) papers FROM ijpass_journals.affiliationdata_tbl affiliation LEFT JOIN ijpass_journals.authordata_tbl source_author ON LOWER(TRIM(LEADING ', ' FROM TRIM(source_author.university_company)))=LOWER(TRIM(LEADING ', ' FROM TRIM(affiliation.university_company))) LEFT JOIN ijpass_journals.manuscript_author_tbl authorship ON authorship.author_data_id=source_author.author_data_id WHERE TRIM(affiliation.country)<>'' GROUP BY affiliation.country`;
  const manuscriptRecords = await prisma.$queryRaw<Array<{
    id: bigint;
    sourceId: bigint;
    sourceTitle: string;
    title: string;
    authors: string | null;
    articleCode: string | null;
    doi: string | null;
    publicationYear: number | null;
  }>>`SELECT manuscript.manuscript_id id,manuscript.journal_id sourceId,source.journal_title sourceTitle,
      manuscript.article_title title,GROUP_CONCAT(author.author_name ORDER BY link.author_order SEPARATOR ', ') authors,
      manuscript.article_code articleCode,manuscript.doi,manuscript.publication_year publicationYear
    FROM ijpass_journals.manuscript_tbl manuscript
    INNER JOIN ijpass_journals.sourcedata_tbl source ON source.source_data_id=manuscript.journal_id
    LEFT JOIN ijpass_journals.manuscript_author_tbl link ON link.manuscript_id=manuscript.manuscript_id
    LEFT JOIN ijpass_journals.authordata_tbl author ON author.author_data_id=link.author_data_id
    GROUP BY manuscript.manuscript_id,manuscript.journal_id,source.journal_title,manuscript.article_title,
      manuscript.article_code,manuscript.doi,manuscript.publication_year`;
  const members = await prisma.member.findMany({
    where: { active: true },
    include: { membershipCategory: { select: { name: true } } },
  });
  const text: estypes.MappingTextProperty = {
    type: "text",
    analyzer: "standard",
    fields: { keyword: { type: "keyword", ignore_above: 256 } },
  };
  await recreate(`${prefix}-resources`, {
    title: text,
    abbreviation: text,
    subject: text,
    publisher: text,
    type: { type: "keyword" },
    manuscriptTitles: { type: "text" },
  });
  await recreate(`${prefix}-authors`, {
    name: text,
    salutation: { type: "keyword" },
    orcid: { type: "keyword" },
    affiliation: text,
    country: text,
    papers: { type: "integer" },
  });
  await recreate(`${prefix}-affiliations`, {
    name: text,
    address: text,
    country: text,
    authors: { type: "integer" },
    papers: { type: "integer" },
  });
  await recreate(`${prefix}-countries`, {
    country: text,
    affiliations: { type: "integer" },
    authors: { type: "integer" },
    papers: { type: "integer" },
  });
  await recreate(`${prefix}-manuscripts`, {
    sourceId: { type: "integer" },
    sourceTitle: text,
    title: text,
    authors: text,
    articleCode: text,
    doi: text,
    publicationYear: { type: "integer" },
  });
  await recreate(`${prefix}-members`, {
    name: text,
    affiliation: text,
    country: text,
    category: text,
    expertise: text,
  });
  await bulk(
    `${prefix}-resources`,
    resources.map((row) => ({
      id: Number(row.id),
      title: row.title,
      abbreviation: row.abbreviation,
      subject: row.subject,
      publisher: row.publisher,
      type: row.type,
      manuscriptTitles: manuscriptMap.get(String(row.id)) || [],
    })),
  );
  await bulk(
    `${prefix}-authors`,
    authors.map((row) => ({
      ...row,
      id: Number(row.id),
      papers: Number(row.papers),
    })),
  );
  await bulk(
    `${prefix}-affiliations`,
    affiliations.map((row) => ({
      ...row,
      id: Number(row.id),
      authors: Number(row.authors),
      papers: Number(row.papers),
    })),
  );
  await bulk(
    `${prefix}-countries`,
    countries.map((row) => ({
      id: row.country,
      ...row,
      affiliations: Number(row.affiliations),
      authors: Number(row.authors),
      papers: Number(row.papers),
    })),
  );
  await bulk(
    `${prefix}-manuscripts`,
    manuscriptRecords.map((row) => ({
      ...row,
      id: Number(row.id),
      sourceId: Number(row.sourceId),
    })),
  );
  await bulk(
    `${prefix}-members`,
    members.map((member) => ({
      id: member.id,
      name: member.fullName,
      affiliation: member.affiliation,
      country: member.country,
      category: member.membershipCategory.name,
      expertise: member.fieldOfExpertise,
    })),
  );
  console.log(
    `Elasticsearch synchronized: ${resources.length} resources, ${manuscriptRecords.length} manuscripts, ${authors.length} authors, ${affiliations.length} affiliations, ${countries.length} countries, ${members.length} members.`,
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
