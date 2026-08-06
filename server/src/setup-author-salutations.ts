import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma=new PrismaClient();

async function main(){
  const columns=await prisma.$queryRawUnsafe<Array<{columnCount:bigint}>>(`SELECT COUNT(*) columnCount FROM information_schema.columns WHERE table_schema='ijpass_journals' AND table_name='author_profile_tbl' AND column_name='salutation'`);
  if(!Number(columns[0]?.columnCount||0)) await prisma.$executeRawUnsafe(`ALTER TABLE ijpass_journals.author_profile_tbl ADD COLUMN salutation VARCHAR(20) NULL AFTER source_author_id`);
  const authors=await prisma.$queryRawUnsafe<Array<{id:bigint;salutation:string|null;authorName:string}>>(`SELECT author_profile_id id,salutation,author_name authorName FROM ijpass_journals.author_profile_tbl`);
  const salutations:[RegExp,string][]=[
    [/^Prof\.?\s*Dr\.\s*,?\s*/i,'Prof. Dr.'],[/^Prof\.?\s+Dr\s*,?\s+/i,'Prof. Dr.'],
    [/^Dr\.\s*,?\s*/i,'Dr.'],[/^Dr\s*,?\s+/i,'Dr.'],
    [/^Mr\.\s*,?\s*/i,'Mr.'],[/^Mr\s*,?\s+/i,'Mr.'],
    [/^Mrs\.\s*,?\s*/i,'Mrs.'],[/^Mrs\s*,?\s+/i,'Mrs.'],
    [/^Ms\.\s*,?\s*/i,'Ms.'],[/^Ms\s*,?\s+/i,'Ms.'],
    [/^Er\.\s*,?\s*/i,'Er.'],[/^Er\s*,?\s+/i,'Er.']
  ];
  const updates=[];
  for(const author of authors){
    let authorName=author.authorName.replace(/^[\s,]+/,'').replace(/\s*,?\s*(?:Ph\.?\s*D\.?|D\.?\s*Sc\.?|M\.?\s*D\.?)\s*,?/gi,' ').replace(/\s{2,}/g,' ').trim();
    let salutation=author.salutation;
    for(const [pattern,canonical] of salutations){if(pattern.test(authorName)){authorName=authorName.replace(pattern,'').replace(/^[\s,]+/,'').trim();salutation=canonical;break;}}
    authorName=authorName.replace(/^[\s,]+|[\s,]+$/g,'').trim();
    if(authorName&& (authorName!==author.authorName||salutation!==author.salutation)) updates.push(prisma.$executeRawUnsafe(`UPDATE ijpass_journals.author_profile_tbl SET salutation=?,author_name=? WHERE author_profile_id=?`,salutation,authorName,author.id));
  }
  for(let index=0;index<updates.length;index+=250) await prisma.$transaction(updates.slice(index,index+250));
  const verifiedAuthors=await prisma.$queryRawUnsafe<Array<{id:bigint;salutation:string|null;authorName:string}>>(`SELECT author_profile_id id,salutation,author_name authorName FROM ijpass_journals.author_profile_tbl WHERE author_profile_id IN (1738,2787) ORDER BY author_profile_id`);
  const cleaned=await prisma.$queryRawUnsafe<Array<{authorName:string}>>(`SELECT author_name authorName FROM ijpass_journals.author_profile_tbl`);
  const unresolved=cleaned.filter(item=>/^[\s,]+|(?:Ph\.?\s*D\.?|D\.?\s*Sc\.?|M\.?\s*D\.?)|^(?:Prof\.?\s*Dr\.|Dr\.|Mr\.|Mrs\.|Ms\.|Er\.)/i.test(item.authorName)).length;
  console.log(`Cleaned ${updates.length} of ${authors.length} author profiles.`);
  console.log(`Profiles still containing salutations, Ph.D/DSc/M.D, or leading commas: ${unresolved}.`);
  for(const author of verifiedAuthors) console.log(`Author ${Number(author.id)}: ${author.salutation||''} ${author.authorName}`.trim());
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
