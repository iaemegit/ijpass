import { Client } from "@elastic/elasticsearch";

const node = process.env.ELASTICSEARCH_URL?.trim();
export const elastic = node
  ? new Client({ node, requestTimeout: 30000, maxRetries: 1 })
  : null;

export async function searchIndexIds(
  index: string,
  query: string,
  fields: string[],
  exactField?: string,
): Promise<string[] | null> {
  if (!elastic || !query.trim()) return null;
  try {
    if (exactField) {
      const exact = await elastic.search(
        {
          index,
          size: 10000,
          _source: false,
          query: { term: { [exactField]: { value: query.trim(), case_insensitive: true } } },
        },
        { requestTimeout: 3000 },
      );
      if (exact.hits.hits.length) return exact.hits.hits.map((hit) => hit._id!);
    }
    const result = await elastic.search(
      {
        index,
        track_total_hits: true,
        size: 10000,
        _source: false,
        query: {
          multi_match: {
            query: query.trim(),
            fields,
            type: "best_fields",
            operator: "and",
            fuzziness: "AUTO",
          },
        },
      },
      { requestTimeout: 3000 },
    );
    return result.hits.hits.map((hit) => hit._id!);
  } catch (error) {
    console.warn(
      `Elasticsearch search unavailable for ${index}; using MySQL fallback.`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function searchAuthorIds(query: string): Promise<string[] | null> {
  if (!elastic || !query.trim()) return null;
  try {
    const escaped = query.trim().toLocaleLowerCase().replace(/[?*\\]/g, "\\$&");
    const result = await elastic.search(
      {
        index: "ijpass-authors",
        size: 10000,
        _source: false,
        query: {
          bool: {
            should: [
              { wildcard: { "name.keyword": { value: `*${escaped}*`, case_insensitive: true } } },
              { match_bool_prefix: { name: { query: query.trim(), operator: "and" } } },
            ],
            minimum_should_match: 1,
          },
        },
      },
      { requestTimeout: 3000 },
    );
    return result.hits.hits.map((hit) => hit._id!);
  } catch (error) {
    console.warn(
      "Elasticsearch author search unavailable; using MySQL fallback.",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function searchCountryIds(query: string): Promise<string[] | null> {
  if (!elastic || !query.trim()) return null;
  try {
    const escaped = query.trim().toLocaleLowerCase().replace(/[?*\\]/g, "\\$&");
    const result = await elastic.search(
      {
        index: "ijpass-countries",
        size: 1000,
        _source: false,
        query: {
          bool: {
            should: [
              { wildcard: { "country.keyword": { value: `*${escaped}*`, case_insensitive: true } } },
              { match_bool_prefix: { country: { query: query.trim(), operator: "and" } } },
            ],
            minimum_should_match: 1,
          },
        },
      },
      { requestTimeout: 3000 },
    );
    return result.hits.hits.map((hit) => hit._id!);
  } catch (error) {
    console.warn(
      "Elasticsearch country search unavailable; using MySQL fallback.",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function suggestResourceTitles(query: string): Promise<string[] | null> {
  if (!elastic || query.trim().length < 2) return [];
  try {
    const result = await elastic.search({
      index: "ijpass-resources",
      size: 8,
      _source: ["title"],
      query: { match_phrase_prefix: { title: { query: query.trim(), max_expansions: 50 } } },
    }, { requestTimeout: 3000 });
    return result.hits.hits.map((hit) => (hit._source as { title: string }).title);
  } catch {
    return null;
  }
}

export async function suggestIndexValues(
  index: string,
  query: string,
  field: string,
  options: { size?: number; filters?: Array<Record<string, unknown>> } = {},
): Promise<string[] | null> {
  if (!elastic || query.trim().length < 2) return [];
  try {
    const escaped = query.trim().toLocaleLowerCase().replace(/[?*\\]/g, "\\$&");
    const result = await elastic.search({
      index,
      size: options.size ?? 16,
      _source: [field],
      query: {
        bool: {
          filter: options.filters ?? [],
          should: [
            { wildcard: { [`${field}.keyword`]: { value: `*${escaped}*`, case_insensitive: true, boost: 4 } } },
            { match_phrase_prefix: { [field]: { query: query.trim(), max_expansions: 50, boost: 3 } } },
            { match_bool_prefix: { [field]: { query: query.trim(), operator: "and" } } },
          ],
          minimum_should_match: 1,
        },
      },
    }, { requestTimeout: 3000 });
    const values = result.hits.hits.flatMap((hit) => {
      const value = (hit._source as Record<string, unknown> | undefined)?.[field];
      return Array.isArray(value) ? value : [value];
    });
    return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
      .sort((first, second) => {
        const firstStarts = first.toLocaleLowerCase().startsWith(query.trim().toLocaleLowerCase()) ? 0 : 1;
        const secondStarts = second.toLocaleLowerCase().startsWith(query.trim().toLocaleLowerCase()) ? 0 : 1;
        return firstStarts - secondStarts || first.localeCompare(second);
      })
      .slice(0, 8);
  } catch {
    return null;
  }
}

export async function searchManuscriptIds(query: string, sourceId?: number): Promise<string[] | null> {
  if (!elastic || !query.trim()) return null;
  try {
    const result = await elastic.search({
      index: "ijpass-manuscripts",
      size: 10000,
      _source: false,
      query: {
        bool: {
          filter: sourceId ? [{ term: { sourceId } }] : [],
          must: [{
            multi_match: {
              query: query.trim(),
              fields: ["title^4", "authors^3", "sourceTitle^2", "articleCode", "doi"],
              type: "best_fields",
              operator: "and",
              fuzziness: "AUTO",
            },
          }],
        },
      },
    }, { requestTimeout: 3000 });
    return result.hits.hits.map((hit) => hit._id!);
  } catch (error) {
    console.warn(
      "Elasticsearch manuscript search unavailable; using MySQL fallback.",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function searchMemberIds(query: string): Promise<string[] | null> {
  return searchIndexIds("ijpass-members", query, ["name^4", "affiliation^3", "country^2", "category^2", "expertise"]);
}

export async function suggestAuthorNames(query: string): Promise<string[] | null> {
  if (!elastic || query.trim().length < 2) return [];
  try {
    const escaped = query.trim().toLocaleLowerCase().replace(/[?*\\]/g, "\\$&");
    const result = await elastic.search({
      index: "ijpass-authors",
      size: 12,
      _source: ["name"],
      query: {
        bool: {
          should: [
            { wildcard: { "name.keyword": { value: `*${escaped}*`, case_insensitive: true, boost: 4 } } },
            { match_bool_prefix: { name: { query: query.trim(), operator: "and", boost: 2 } } },
          ],
          minimum_should_match: 1,
        },
      },
    }, { requestTimeout: 3000 });
    return [...new Set(result.hits.hits.map((hit) => (hit._source as { name: string }).name).filter(Boolean))].slice(0, 8);
  } catch {
    return null;
  }
}

export async function removeAuthorSearchDocuments(authorIds: number[]) {
  if (!elastic || !authorIds.length) return;
  try {
    await elastic.bulk({
      refresh: true,
      operations: authorIds.flatMap((id) => [{ delete: { _index: "ijpass-authors", _id: String(id) } }]),
    }, { requestTimeout: 5000 });
  } catch (error) {
    console.warn(
      "Merged author documents could not be removed from Elasticsearch.",
      error instanceof Error ? error.message : error,
    );
  }
}

export async function removeAffiliationSearchDocuments(affiliationIds: number[]) {
  if (!elastic || !affiliationIds.length) return;
  try {
    await elastic.bulk({
      refresh: true,
      operations: affiliationIds.flatMap((id) => [{ delete: { _index: "ijpass-affiliations", _id: String(id) } }]),
    }, { requestTimeout: 5000 });
  } catch (error) {
    console.warn(
      "Merged affiliation documents could not be removed from Elasticsearch.",
      error instanceof Error ? error.message : error,
    );
  }
}

export async function elasticHealth() {
  if (!elastic) return { configured: false, available: false };
  try {
    const health = await elastic.cluster.health();
    return { configured: true, available: true, status: health.status };
  } catch {
    return { configured: true, available: false };
  }
}
