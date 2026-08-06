import type { PrismaClient } from "@prisma/client";

export type ResourceMetric={citeMetrixScore:number;percentile:number;citations:number;papers:number;citedPercent:number;hIndex:number;i10Index:number};
const cache=new Map<number,Promise<Map<number,ResourceMetric>>>();
const normalize=(value:string|null)=>String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"");

export function getResourceMetrics(prisma:PrismaClient,year:number){
  const existing=cache.get(year);if(existing)return existing;
  const calculation=calculate(prisma,year).catch(error=>{cache.delete(year);throw error;});
  cache.set(year,calculation);return calculation;
}

async function calculate(prisma:PrismaClient,endYear:number){
  const startYear=endYear-2;
  const [papers,references,sources]=await Promise.all([
    prisma.$queryRaw<Array<{id:bigint;journalId:bigint;title:string;year:number|null}>>`SELECT manuscript_id id,journal_id journalId,article_title title,publication_year year FROM ijpass_journals.manuscript_tbl WHERE publication_year BETWEEN ${startYear} AND ${endYear}`,
    prisma.$queryRaw<Array<{citingId:bigint;title:string;year:number|null}>>`SELECT reference.manuscript_id citingId,reference.article_title title,reference.publication_year year FROM ijpass_journals.refdat_table reference INNER JOIN ijpass_journals.manuscript_tbl citing ON citing.manuscript_id=reference.manuscript_id WHERE citing.publication_year BETWEEN ${startYear} AND ${endYear} AND reference.publication_year BETWEEN ${startYear} AND ${endYear}`,
    prisma.$queryRaw<Array<{id:bigint;subject:string|null}>>`SELECT source_data_id id,NULLIF(TRIM(subject_area),'') subject FROM ijpass_journals.sourcedata_tbl`,
  ]);
  const paperByKey=new Map<string,Array<{id:number;journalId:number}>>(),citationCounts=new Map<number,number>();
  for(const paper of papers){const key=`${paper.year}|${normalize(paper.title)}`;if(key.endsWith('|'))continue;const list=paperByKey.get(key)||[];list.push({id:Number(paper.id),journalId:Number(paper.journalId)});paperByKey.set(key,list);citationCounts.set(Number(paper.id),0);}
  for(const reference of references){const matches=paperByKey.get(`${reference.year}|${normalize(reference.title)}`)||[],citingId=Number(reference.citingId);for(const match of matches)if(match.id!==citingId)citationCounts.set(match.id,(citationCounts.get(match.id)||0)+1);}
  const journalPapers=new Map<number,number[]>();for(const paper of papers){const journalId=Number(paper.journalId),list=journalPapers.get(journalId)||[];list.push(citationCounts.get(Number(paper.id))||0);journalPapers.set(journalId,list);}
  const metrics=new Map<number,ResourceMetric>();for(const [journalId,counts] of journalPapers){const papersCount=counts.length,citations=counts.reduce((sum,value)=>sum+value,0),ranked=[...counts].sort((a,b)=>b-a);let hIndex=0;ranked.forEach((value,index)=>{if(value>=index+1)hIndex=index+1;});metrics.set(journalId,{papers:papersCount,citations,citeMetrixScore:Number((citations/papersCount).toFixed(2)),citedPercent:Number((100*counts.filter(Boolean).length/papersCount).toFixed(1)),hIndex,i10Index:counts.filter(value=>value>=10).length,percentile:0});}
  for(const source of sources)if(!metrics.has(Number(source.id)))metrics.set(Number(source.id),{papers:0,citations:0,citeMetrixScore:0,citedPercent:0,hIndex:0,i10Index:0,percentile:0});
  const subjectGroups=new Map<string,ResourceMetric[]>();
  for(const source of sources){const metric=metrics.get(Number(source.id))!;if(!metric.papers)continue;const categories=String(source.subject||'').split(/[;|]/).map(value=>value.trim()).filter(Boolean);for(const category of categories.length?categories:['Unclassified']){const group=subjectGroups.get(category)||[];group.push(metric);subjectGroups.set(category,group);}}
  for(const group of subjectGroups.values()){
    const frequencies=new Map<number,number>();for(const metric of group)frequencies.set(metric.citeMetrixScore,(frequencies.get(metric.citeMetrixScore)||0)+1);
    let lower=0;for(const score of [...frequencies.keys()].sort((a,b)=>a-b)){const same=frequencies.get(score)!,percentile=Math.floor(100*(lower+0.5*same)/group.length);for(const metric of group)if(metric.citeMetrixScore===score)metric.percentile=Math.max(metric.percentile,percentile);lower+=same;}
  }
  return metrics;
}
